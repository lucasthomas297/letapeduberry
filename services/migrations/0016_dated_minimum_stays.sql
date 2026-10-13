CREATE TABLE minimum_stay_dates (
 arrival_date TEXT PRIMARY KEY CHECK(length(arrival_date)=10),
 min_nights INTEGER NOT NULL CHECK(min_nights BETWEEN 1 AND 60),
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
DROP TRIGGER enforce_minimum_stay;
CREATE TRIGGER enforce_minimum_stay BEFORE INSERT ON stays
WHEN julianday(NEW.departure)-julianday(NEW.arrival)<COALESCE(
 (SELECT min_nights FROM minimum_stay_dates WHERE arrival_date=NEW.arrival),
 (SELECT min_nights FROM booking_settings WHERE id=1))
BEGIN
 SELECT RAISE(ABORT,'Durée inférieure au minimum de nuits');
END;
