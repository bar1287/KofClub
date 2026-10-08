-- Showdown choices (roadmap W1.5): a seat's losing hands are mucked at
-- showdown when the rules allow it (the player can turn this off to always
-- show). Cards shown voluntarily after a hand are CARDS_SHOWN events.
ALTER TABLE table_seats ADD COLUMN muck_losing boolean NOT NULL DEFAULT true;
