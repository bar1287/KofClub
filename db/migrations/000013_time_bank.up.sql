-- Time bank (roadmap W1.2): extra thinking time per seat, used only after
-- the turn timer runs out. A table sets the bank (also its cap; 0 turns it
-- off) and how much is added back for every hand a player is dealt into.
-- The game service keeps each seat's remaining bank in table_seats.
ALTER TABLE tables
  ADD COLUMN time_bank_ms integer NOT NULL DEFAULT 30000 CHECK (time_bank_ms BETWEEN 0 AND 300000),
  ADD COLUMN time_bank_refill_ms integer NOT NULL DEFAULT 2000 CHECK (time_bank_refill_ms BETWEEN 0 AND 60000);

ALTER TABLE table_seats ADD COLUMN time_bank_ms integer NOT NULL DEFAULT 0 CHECK (time_bank_ms >= 0);
UPDATE table_seats s SET time_bank_ms = t.time_bank_ms FROM tables t WHERE t.id = s.table_id;
