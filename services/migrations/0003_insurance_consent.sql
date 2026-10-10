-- Keep the guest declaration separate from rules and contract acceptance.
ALTER TABLE stays ADD COLUMN insurance_accepted_at TEXT;
