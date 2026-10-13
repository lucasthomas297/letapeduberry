CREATE TABLE booking_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 min_nights INTEGER NOT NULL DEFAULT 1 CHECK(min_nights BETWEEN 1 AND 60),
 updated_at TEXT,
 updated_by TEXT
);
INSERT INTO booking_settings(id,min_nights) VALUES(1,1);
-- Enforce the current setting even if it changes while a request is being prepared.
CREATE TRIGGER enforce_minimum_stay BEFORE INSERT ON stays
WHEN julianday(NEW.departure)-julianday(NEW.arrival)<(SELECT min_nights FROM booking_settings WHERE id=1)
BEGIN
 SELECT RAISE(ABORT,'Durée inférieure au minimum de nuits');
END;
