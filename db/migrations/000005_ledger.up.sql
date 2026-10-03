-- M3 ledger (ADR-003): double-entry, append-only virtual-chip accounting.
--
-- Chips are scoped per club (each club is its own asset). Every movement is
-- a transaction whose entries sum to zero. The ONLY write path is
-- ledger_post()/ledger_reverse(); direct balance updates are rejected.
--
-- Custom SQLSTATEs raised by the ledger (mapped by TS and Go clients):
--   KL001 insufficient chips        KL002 idempotency conflict
--   KL003 invariant violation       KL004 account not usable
--   KL005 already reversed

CREATE TABLE ledger_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES clubs (id),
  kind           text NOT NULL CHECK (kind IN ('CLUB_TREASURY', 'MEMBER_WALLET', 'TABLE_STACK')),
  owner_type     text NOT NULL CHECK (owner_type IN ('CLUB', 'USER')),
  owner_id       uuid NOT NULL,
  -- Set for TABLE_STACK accounts (a player's chips at one table). The FK to
  -- tables is added by the table-service migration.
  table_id       uuid,
  asset_code     text NOT NULL DEFAULT 'CHIP' CHECK (asset_code = 'CHIP'),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  -- Only the club treasury (the issuer) may go negative: -treasury balance
  -- equals the chips in circulation in that club.
  allow_negative boolean NOT NULL DEFAULT false,
  balance        bigint NOT NULL DEFAULT 0,
  version        bigint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_non_negative CHECK (allow_negative OR balance >= 0),
  CONSTRAINT ledger_accounts_table_scope CHECK ((kind = 'TABLE_STACK') = (table_id IS NOT NULL)),
  CONSTRAINT ledger_accounts_owner CHECK (
    (kind = 'CLUB_TREASURY' AND owner_type = 'CLUB' AND owner_id = club_id AND allow_negative)
    OR (kind <> 'CLUB_TREASURY' AND owner_type = 'USER' AND NOT allow_negative)
  ),
  CONSTRAINT ledger_accounts_identity UNIQUE NULLS NOT DISTINCT (kind, club_id, owner_id, table_id, asset_code)
);
CREATE INDEX ledger_accounts_owner_idx ON ledger_accounts (owner_id, club_id);
CREATE INDEX ledger_accounts_table_idx ON ledger_accounts (table_id) WHERE table_id IS NOT NULL;

CREATE TABLE ledger_transactions (
  id              uuid PRIMARY KEY,
  -- Business idempotency key: retries with the same key never move chips twice.
  external_ref    text NOT NULL CHECK (char_length(external_ref) BETWEEN 3 AND 200),
  kind            text NOT NULL CHECK (kind IN (
                    'CLUB_GRANT', 'CLUB_DEDUCTION', 'PROMOTIONAL_CREDIT', 'ADMIN_ADJUSTMENT',
                    'TABLE_BUY_IN', 'TABLE_CASH_OUT', 'HAND_SETTLEMENT', 'REVERSAL')),
  club_id         uuid NOT NULL REFERENCES clubs (id),
  actor_type      text NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'GAME_SERVICE')),
  actor_user_id   uuid REFERENCES users (id),
  reference_type  text,
  reference_id    text,
  reverses_tx_id  uuid REFERENCES ledger_transactions (id),
  request_hash    text NOT NULL,
  metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_transactions_external_ref_key UNIQUE (external_ref),
  CONSTRAINT ledger_transactions_single_reversal UNIQUE (reverses_tx_id),
  CONSTRAINT ledger_transactions_reversal_ref CHECK ((kind = 'REVERSAL') = (reverses_tx_id IS NOT NULL))
);
CREATE INDEX ledger_transactions_club_idx ON ledger_transactions (club_id, created_at DESC);
CREATE INDEX ledger_transactions_reference_idx ON ledger_transactions (reference_type, reference_id);

CREATE TABLE ledger_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id          uuid NOT NULL REFERENCES ledger_transactions (id),
  account_id     uuid NOT NULL REFERENCES ledger_accounts (id),
  amount_signed  bigint NOT NULL CHECK (amount_signed <> 0),
  balance_before bigint NOT NULL,
  balance_after  bigint NOT NULL,
  reason         text,
  hand_id        uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_balance_math CHECK (balance_after = balance_before + amount_signed),
  CONSTRAINT ledger_entries_one_per_account UNIQUE (tx_id, account_id)
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, created_at DESC);
CREATE INDEX ledger_entries_hand_idx ON ledger_entries (hand_id) WHERE hand_id IS NOT NULL;

-- Immutability: ledger history can never be edited or deleted.
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Balances (the projection) may only change inside ledger_post().
CREATE FUNCTION ledger_accounts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger accounts cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.balance IS DISTINCT FROM OLD.balance OR NEW.version IS DISTINCT FROM OLD.version)
     AND coalesce(current_setting('kofclub.ledger_posting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'ledger balances can only change through ledger_post()' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.club_id, NEW.kind, NEW.owner_type, NEW.owner_id, NEW.table_id, NEW.asset_code, NEW.allow_negative)
     IS DISTINCT FROM
     (OLD.club_id, OLD.kind, OLD.owner_type, OLD.owner_id, OLD.table_id, OLD.asset_code, OLD.allow_negative) THEN
    RAISE EXCEPTION 'ledger account identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_accounts_guard BEFORE UPDATE OR DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_accounts_guard();

-- New accounts always start at zero; chips arrive only through postings.
CREATE FUNCTION ledger_accounts_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance <> 0 OR NEW.version <> 0 THEN
    RAISE EXCEPTION 'ledger accounts must be created with a zero balance' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_accounts_insert_guard BEFORE INSERT ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_accounts_insert_guard();

-- Zero-sum is re-asserted at commit for every transaction, independently of
-- ledger_post's own check (defense in depth).
CREATE FUNCTION ledger_assert_zero_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sum bigint;
BEGIN
  SELECT coalesce(sum(amount_signed), 0) INTO v_sum FROM ledger_entries WHERE tx_id = NEW.tx_id;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (sum=%)', NEW.tx_id, v_sum USING ERRCODE = 'KL003';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ledger_entries_zero_sum AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_assert_zero_sum();

-- Returns the id of an account, creating it (at zero) if needed.
CREATE FUNCTION ledger_ensure_account(p_club_id uuid, p_kind text, p_owner_id uuid, p_table_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_kind = 'CLUB_TREASURY' THEN
    p_owner_id := p_club_id;
  END IF;
  SELECT id INTO v_id FROM ledger_accounts
   WHERE kind = p_kind AND club_id = p_club_id AND owner_id = p_owner_id
     AND table_id IS NOT DISTINCT FROM p_table_id AND asset_code = 'CHIP';
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO ledger_accounts (club_id, kind, owner_type, owner_id, table_id, allow_negative)
  VALUES (p_club_id, p_kind,
          CASE WHEN p_kind = 'CLUB_TREASURY' THEN 'CLUB' ELSE 'USER' END,
          p_owner_id, p_table_id, p_kind = 'CLUB_TREASURY')
  ON CONFLICT ON CONSTRAINT ledger_accounts_identity DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM ledger_accounts
     WHERE kind = p_kind AND club_id = p_club_id AND owner_id = p_owner_id
       AND table_id IS NOT DISTINCT FROM p_table_id AND asset_code = 'CHIP';
  END IF;
  RETURN v_id;
END;
$$;

-- Posts one balanced transaction. Idempotent on p_external_ref: a retry
-- with identical content returns the original transaction (created=false);
-- a retry with different content raises KL002.
--
-- p_entries: [{"accountId": uuid, "amount": int8, "reason": text?, "handId": uuid?}, ...]
CREATE FUNCTION ledger_post(
  p_tx_id          uuid,
  p_external_ref   text,
  p_kind           text,
  p_club_id        uuid,
  p_actor_type     text,
  p_actor_user_id  uuid,
  p_reference_type text,
  p_reference_id   text,
  p_metadata       jsonb,
  p_entries        jsonb,
  p_reverses_tx_id uuid DEFAULT NULL
) RETURNS TABLE (tx_id uuid, created boolean)
LANGUAGE plpgsql AS $$
DECLARE
  c_max_amount constant bigint := 1000000000000000; -- 10^15, JSON-safe
  v_hash      text;
  v_existing  record;
  v_entry     record;
  v_acct      record;
  v_sum       numeric := 0;
  v_count     int := 0;
  v_kinds     text[] := '{}';
  v_owners    uuid[] := '{}';
  v_tables    uuid[] := '{}';
  v_signs     int[] := '{}';
  v_entry_kind text;
BEGIN
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION 'a ledger transaction needs at least two entries' USING ERRCODE = 'KL003';
  END IF;

  -- Canonical request hash (entries ordered by account) for idempotency checks.
  SELECT encode(digest(
           p_kind || '|' || p_club_id::text || '|' || coalesce(p_reverses_tx_id::text, '') || '|' ||
           string_agg((e->>'accountId') || ':' || (e->>'amount'), ',' ORDER BY e->>'accountId'),
           'sha256'), 'hex')
    INTO v_hash
    FROM jsonb_array_elements(p_entries) e;

  SELECT t.id, t.request_hash INTO v_existing FROM ledger_transactions t WHERE t.external_ref = p_external_ref;
  IF FOUND THEN
    IF v_existing.request_hash <> v_hash THEN
      RAISE EXCEPTION 'external_ref % was already used for a different transaction', p_external_ref USING ERRCODE = 'KL002';
    END IF;
    RETURN QUERY SELECT v_existing.id, false;
    RETURN;
  END IF;

  -- Validate amounts and zero-sum before touching any account.
  FOR v_entry IN SELECT value AS e FROM jsonb_array_elements(p_entries) LOOP
    IF jsonb_typeof(v_entry.e->'amount') <> 'number'
       OR (v_entry.e->>'amount')::numeric <> trunc((v_entry.e->>'amount')::numeric)
       OR (v_entry.e->>'amount')::numeric = 0
       OR abs((v_entry.e->>'amount')::numeric) > c_max_amount THEN
      RAISE EXCEPTION 'invalid entry amount %', v_entry.e->>'amount' USING ERRCODE = 'KL003';
    END IF;
    v_sum := v_sum + (v_entry.e->>'amount')::numeric;
    v_count := v_count + 1;
  END LOOP;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'ledger transaction does not balance (sum=%)', v_sum USING ERRCODE = 'KL003';
  END IF;
  IF (SELECT count(DISTINCT e->>'accountId') FROM jsonb_array_elements(p_entries) e) <> v_count THEN
    RAISE EXCEPTION 'an account may appear only once per transaction' USING ERRCODE = 'KL003';
  END IF;

  -- Lock all accounts in a deterministic order to avoid deadlocks.
  FOR v_acct IN
    SELECT a.* FROM ledger_accounts a
     WHERE a.id IN (SELECT (e->>'accountId')::uuid FROM jsonb_array_elements(p_entries) e)
     ORDER BY a.id FOR UPDATE
  LOOP
    IF v_acct.club_id <> p_club_id THEN
      RAISE EXCEPTION 'account % belongs to another club', v_acct.id USING ERRCODE = 'KL004';
    END IF;
    IF v_acct.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'account % is %', v_acct.id, v_acct.status USING ERRCODE = 'KL004';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM ledger_accounts a
       WHERE a.id IN (SELECT (e->>'accountId')::uuid FROM jsonb_array_elements(p_entries) e)) <> v_count THEN
    RAISE EXCEPTION 'unknown ledger account' USING ERRCODE = 'KL004';
  END IF;

  -- Allowed flows per transaction kind (defense against caller bugs).
  SELECT array_agg(a.kind ORDER BY a.id), array_agg(a.owner_id ORDER BY a.id),
         array_agg(a.table_id ORDER BY a.id), array_agg(sign((e->>'amount')::numeric)::int ORDER BY a.id)
    INTO v_kinds, v_owners, v_tables, v_signs
    FROM jsonb_array_elements(p_entries) e JOIN ledger_accounts a ON a.id = (e->>'accountId')::uuid;

  IF p_kind IN ('CLUB_GRANT', 'PROMOTIONAL_CREDIT', 'CLUB_DEDUCTION', 'ADMIN_ADJUSTMENT') THEN
    IF v_count <> 2 OR NOT ('CLUB_TREASURY' = ANY (v_kinds)) OR NOT ('MEMBER_WALLET' = ANY (v_kinds)) THEN
      RAISE EXCEPTION '% must move chips between the treasury and one wallet', p_kind USING ERRCODE = 'KL003';
    END IF;
    -- Direction: grants/credits mint into a wallet, deductions burn from it.
    FOR i IN 1..2 LOOP
      IF v_kinds[i] = 'MEMBER_WALLET' AND (
           (p_kind IN ('CLUB_GRANT', 'PROMOTIONAL_CREDIT') AND v_signs[i] < 0) OR
           (p_kind = 'CLUB_DEDUCTION' AND v_signs[i] > 0)) THEN
        RAISE EXCEPTION '% has the wrong direction', p_kind USING ERRCODE = 'KL003';
      END IF;
    END LOOP;
  ELSIF p_kind IN ('TABLE_BUY_IN', 'TABLE_CASH_OUT') THEN
    IF v_count <> 2 OR NOT ('TABLE_STACK' = ANY (v_kinds)) OR NOT ('MEMBER_WALLET' = ANY (v_kinds))
       OR v_owners[1] <> v_owners[2] THEN
      RAISE EXCEPTION '% must move one player''s chips between wallet and table', p_kind USING ERRCODE = 'KL003';
    END IF;
    FOR i IN 1..2 LOOP
      IF v_kinds[i] = 'TABLE_STACK' AND (
           (p_kind = 'TABLE_BUY_IN' AND v_signs[i] < 0) OR (p_kind = 'TABLE_CASH_OUT' AND v_signs[i] > 0)) THEN
        RAISE EXCEPTION '% has the wrong direction', p_kind USING ERRCODE = 'KL003';
      END IF;
    END LOOP;
  ELSIF p_kind = 'HAND_SETTLEMENT' THEN
    FOREACH v_entry_kind IN ARRAY v_kinds LOOP
      IF v_entry_kind <> 'TABLE_STACK' THEN
        RAISE EXCEPTION 'hand settlement may only move chips between table stacks' USING ERRCODE = 'KL003';
      END IF;
    END LOOP;
    IF (SELECT count(DISTINCT t) FROM unnest(v_tables) t) <> 1 THEN
      RAISE EXCEPTION 'hand settlement must stay within one table' USING ERRCODE = 'KL003';
    END IF;
  ELSIF p_kind = 'REVERSAL' THEN
    IF p_reverses_tx_id IS NULL THEN
      RAISE EXCEPTION 'reversal requires the original transaction' USING ERRCODE = 'KL003';
    END IF;
    -- A reversal must be the exact negation of the original entries.
    IF EXISTS (
      (SELECT (e->>'accountId')::uuid, (e->>'amount')::bigint FROM jsonb_array_elements(p_entries) e
       EXCEPT
       SELECT o.account_id, -o.amount_signed FROM ledger_entries o WHERE o.tx_id = p_reverses_tx_id)
      UNION ALL
      (SELECT o.account_id, -o.amount_signed FROM ledger_entries o WHERE o.tx_id = p_reverses_tx_id
       EXCEPT
       SELECT (e->>'accountId')::uuid, (e->>'amount')::bigint FROM jsonb_array_elements(p_entries) e)
    ) THEN
      RAISE EXCEPTION 'reversal entries must negate transaction %', p_reverses_tx_id USING ERRCODE = 'KL003';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported transaction kind %', p_kind USING ERRCODE = 'KL003';
  END IF;

  INSERT INTO ledger_transactions (id, external_ref, kind, club_id, actor_type, actor_user_id,
                                   reference_type, reference_id, reverses_tx_id, request_hash, metadata_json)
  VALUES (p_tx_id, p_external_ref, p_kind, p_club_id, p_actor_type, p_actor_user_id,
          p_reference_type, p_reference_id, p_reverses_tx_id, v_hash, coalesce(p_metadata, '{}'::jsonb));

  PERFORM set_config('kofclub.ledger_posting', 'on', true);
  FOR v_entry IN
    SELECT (e->>'accountId')::uuid AS account_id, (e->>'amount')::bigint AS amount,
           e->>'reason' AS reason, (e->>'handId')::uuid AS hand_id
      FROM jsonb_array_elements(p_entries) e
     ORDER BY e->>'accountId'
  LOOP
    SELECT a.balance, a.allow_negative INTO v_acct FROM ledger_accounts a WHERE a.id = v_entry.account_id;
    IF NOT v_acct.allow_negative AND v_acct.balance + v_entry.amount < 0 THEN
      PERFORM set_config('kofclub.ledger_posting', 'off', true);
      RAISE EXCEPTION 'insufficient chips in account % (balance %, change %)',
        v_entry.account_id, v_acct.balance, v_entry.amount USING ERRCODE = 'KL001';
    END IF;
    INSERT INTO ledger_entries (tx_id, account_id, amount_signed, balance_before, balance_after, reason, hand_id)
    VALUES (p_tx_id, v_entry.account_id, v_entry.amount, v_acct.balance, v_acct.balance + v_entry.amount,
            v_entry.reason, v_entry.hand_id);
    UPDATE ledger_accounts SET balance = balance + v_entry.amount, version = version + 1
     WHERE id = v_entry.account_id;
  END LOOP;
  PERFORM set_config('kofclub.ledger_posting', 'off', true);

  RETURN QUERY SELECT p_tx_id, true;
EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent post with the same external_ref won the race.
    SELECT t.id, t.request_hash INTO v_existing FROM ledger_transactions t WHERE t.external_ref = p_external_ref;
    IF NOT FOUND THEN
      IF p_reverses_tx_id IS NOT NULL THEN
        RAISE EXCEPTION 'transaction % is already reversed', p_reverses_tx_id USING ERRCODE = 'KL005';
      END IF;
      RAISE;
    END IF;
    IF v_existing.request_hash <> v_hash THEN
      RAISE EXCEPTION 'external_ref % was already used for a different transaction', p_external_ref USING ERRCODE = 'KL002';
    END IF;
    RETURN QUERY SELECT v_existing.id, false;
END;
$$;

-- Reverses a transaction by posting its exact negation (corrections).
CREATE FUNCTION ledger_reverse(
  p_tx_id uuid, p_original_tx_id uuid, p_external_ref text,
  p_actor_type text, p_actor_user_id uuid, p_metadata jsonb
) RETURNS TABLE (tx_id uuid, created boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_orig record;
  v_entries jsonb;
BEGIN
  SELECT * INTO v_orig FROM ledger_transactions WHERE id = p_original_tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction % not found', p_original_tx_id USING ERRCODE = 'KL004';
  END IF;
  IF v_orig.kind = 'REVERSAL' THEN
    RAISE EXCEPTION 'a reversal cannot be reversed' USING ERRCODE = 'KL003';
  END IF;
  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE reverses_tx_id = p_original_tx_id AND external_ref <> p_external_ref) THEN
    RAISE EXCEPTION 'transaction % is already reversed', p_original_tx_id USING ERRCODE = 'KL005';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('accountId', account_id, 'amount', -amount_signed,
                                      'reason', 'REVERSAL', 'handId', hand_id))
    INTO v_entries FROM ledger_entries WHERE ledger_entries.tx_id = p_original_tx_id;
  RETURN QUERY SELECT * FROM ledger_post(p_tx_id, p_external_ref, 'REVERSAL', v_orig.club_id, p_actor_type,
                                         p_actor_user_id, 'ledger_transaction', p_original_tx_id::text,
                                         p_metadata, v_entries, p_original_tx_id);
END;
$$;

-- Invariant monitoring: rows returned here indicate a ledger defect.
CREATE VIEW ledger_invariant_violations AS
  SELECT 'UNBALANCED_TRANSACTION' AS violation, e.tx_id::text AS subject, sum(e.amount_signed) AS amount
    FROM ledger_entries e GROUP BY e.tx_id HAVING sum(e.amount_signed) <> 0
  UNION ALL
  SELECT 'PROJECTION_MISMATCH', a.id::text, a.balance - coalesce(sum(e.amount_signed), 0)
    FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
   GROUP BY a.id, a.balance HAVING a.balance <> coalesce(sum(e.amount_signed), 0)
  UNION ALL
  SELECT 'CLUB_NOT_ZERO_SUM', a.club_id::text, sum(a.balance)
    FROM ledger_accounts a GROUP BY a.club_id HAVING sum(a.balance) <> 0
  UNION ALL
  SELECT 'NEGATIVE_BALANCE', a.id::text, a.balance
    FROM ledger_accounts a WHERE NOT a.allow_negative AND a.balance < 0;
