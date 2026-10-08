-- Re-buy and top-up (roadmap W1.3): a seated player may ask the game service
-- to top their stack back up to a target after every hand (0 = off).
ALTER TABLE table_seats
  ADD COLUMN auto_top_up_to bigint NOT NULL DEFAULT 0 CHECK (auto_top_up_to >= 0);
