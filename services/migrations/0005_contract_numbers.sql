-- Allocate the public contract reference once, including before the first preview.
ALTER TABLE stays ADD COLUMN contract_number TEXT;
UPDATE stays SET contract_number=(
 SELECT substr(s.arrival,1,4)||'-'||printf('%03d',s.sequence)
 FROM (SELECT id,arrival,row_number() OVER (PARTITION BY substr(arrival,1,4) ORDER BY created_at,id) AS sequence FROM stays) s
 WHERE s.id=stays.id
);
CREATE UNIQUE INDEX stays_contract_number_unique ON stays(contract_number);
CREATE TABLE contract_counters (year TEXT PRIMARY KEY, last_number INTEGER NOT NULL);
INSERT INTO contract_counters(year,last_number)
 SELECT substr(contract_number,1,4),max(CAST(substr(contract_number,6) AS INTEGER)) FROM stays GROUP BY substr(contract_number,1,4);
CREATE TRIGGER stays_contract_number_insert AFTER INSERT ON stays
WHEN NEW.contract_number IS NULL
BEGIN
 INSERT INTO contract_counters(year,last_number) VALUES(substr(NEW.arrival,1,4),1)
 ON CONFLICT(year) DO UPDATE SET last_number=last_number+1;
 UPDATE stays SET contract_number=substr(NEW.arrival,1,4)||'-'||printf('%03d',(
  SELECT last_number FROM contract_counters WHERE year=substr(NEW.arrival,1,4)
 )) WHERE id=NEW.id;
END;
