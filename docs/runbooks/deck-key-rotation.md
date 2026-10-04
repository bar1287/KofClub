# Runbook: deck-key rotation

Decks and hole cards are stored encrypted (AES-256-GCM, ADR-008) with a key
that only game nodes hold. Every hand records the id of the key that sealed
it (`hands.seal_key_id`). Game nodes read a keyring:

```
DECK_ENCRYPTION_KEYS="2:<base64 32 bytes>,1:<base64 32 bytes>"
```

The **first** key seals new hands; every listed key opens hands sealed with
its id. `DECK_ENCRYPTION_KEY_B64=<key>` is shorthand for a single key with
id 1 (hands sealed before key ids existed used that key). Set one of the two
variables, not both.

## Routine rotation

1. Generate a key in the secret store (`openssl rand -base64 32`) and pick
   the next id (ids are never reused).
2. **Stage**: deploy every game node with the new key listed _after_ the
   active one, e.g. `1:<old>,2:<new>`. Nothing changes yet, but every node
   can now open data sealed with the new key. Wait until the rollout is
   complete (all nodes report `deck_keys_loaded` with both ids).
3. **Activate**: deploy with the new key first, `2:<new>,1:<old>`. New
   hands are sealed with key 2 (`SELECT seal_key_id, count(*) FROM hands
WHERE started_at > now() - interval '5 minutes' GROUP BY 1`).
   Activating before staging finished would let an old node fail to resume
   a key-2 hand after a failover (the hand would be voided).
4. **Re-seal** (optional for routine rotation, required to retire a key):
   run `game-service reseal` once, as a one-off task with the game nodes'
   configuration. It re-encrypts finished hands in batches
   (`-batch 200`, `-dry-run` only reports `hands_per_key`) and skips hands
   in progress; run it again after a minute to catch those.
5. **Retire**: once `game-service reseal -dry-run` shows no hands for the
   old key, remove it from `DECK_ENCRYPTION_KEYS`. A node refuses to start
   if hands in progress still use a key it lacks; history requests for
   hands sealed with a missing key fail (`sealer: key id not configured`).

## Suspected key compromise

Rotate immediately (steps 1–3 can be one deploy if a short risk of voided
in-progress hands during the rollout is acceptable), then re-seal and
retire the compromised key the same day. Past hands remain confidential
only once they are re-sealed: anyone holding the old key _and_ a copy of
the database (including backups) can read the hole cards of hands sealed
with it, so treat older backups as exposed and expire them per the backup
policy ([backup-restore.md](backup-restore.md)).

## Reference

- Tests: `apps/game-service/internal/sealer` (keyring), integration
  `TestDeckKeyRotation` (failover across a rotation, re-seal, retirement).
- Migration 000011 adds `hands.seal_key_id` (existing hands: key 1).
