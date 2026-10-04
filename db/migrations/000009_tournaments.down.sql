-- Ledger history is append-only: refuse to roll back once tournaments
-- (and therefore possibly tournament ledger postings) exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tournaments)
     OR EXISTS (SELECT 1 FROM ledger_accounts WHERE kind = 'TOURNAMENT_POOL') THEN
    RAISE EXCEPTION 'cannot roll back 000009: tournaments exist';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ledger_post(
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

CREATE OR REPLACE FUNCTION ledger_ensure_account(p_club_id uuid, p_kind text, p_owner_id uuid, p_table_id uuid DEFAULT NULL)
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

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check CHECK (kind IN (
  'CLUB_GRANT', 'CLUB_DEDUCTION', 'PROMOTIONAL_CREDIT', 'ADMIN_ADJUSTMENT',
  'TABLE_BUY_IN', 'TABLE_CASH_OUT', 'HAND_SETTLEMENT', 'REVERSAL'));
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_owner;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_owner CHECK (
  (kind = 'CLUB_TREASURY' AND owner_type = 'CLUB' AND owner_id = club_id AND allow_negative)
  OR (kind <> 'CLUB_TREASURY' AND owner_type = 'USER' AND NOT allow_negative)
);
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_owner_type_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_owner_type_check CHECK (owner_type IN ('CLUB', 'USER'));
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_kind_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_kind_check
  CHECK (kind IN ('CLUB_TREASURY', 'MEMBER_WALLET', 'TABLE_STACK'));

DROP TABLE IF EXISTS tournament_transfers;
DROP TABLE IF EXISTS tournament_entries;
DROP TABLE IF EXISTS tournament_runtime;
DROP INDEX IF EXISTS tables_tournament_no_key;
ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_tournament_no;
ALTER TABLE tables DROP COLUMN IF EXISTS tournament_table_no;
ALTER TABLE tables DROP COLUMN IF EXISTS tournament_id;
DROP TABLE IF EXISTS tournament_registrations;
DROP TABLE IF EXISTS tournaments;
