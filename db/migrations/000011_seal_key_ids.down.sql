-- Only safe while every hand is sealed with key 1: older code can open no
-- other key (re-seal with key 1 first: game-service reseal).
ALTER TABLE hands DROP COLUMN seal_key_id;
