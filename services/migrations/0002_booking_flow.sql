ALTER TABLE stays ADD COLUMN comment TEXT NOT NULL DEFAULT '';
ALTER TABLE stays ADD COLUMN customer_address TEXT NOT NULL DEFAULT '';
ALTER TABLE stays ADD COLUMN contract_html TEXT;
ALTER TABLE stays ADD COLUMN contract_hash TEXT;
ALTER TABLE stays ADD COLUMN contract_accepted_at TEXT;
ALTER TABLE stays ADD COLUMN contract_signer TEXT;
ALTER TABLE stays ADD COLUMN guest_token_hash TEXT;
ALTER TABLE stays ADD COLUMN decision_message TEXT NOT NULL DEFAULT '';
ALTER TABLE stays ADD COLUMN checkout_url TEXT;
ALTER TABLE stays ADD COLUMN paid_at TEXT;
ALTER TABLE stays ADD COLUMN owner_accepted_at TEXT;
ALTER TABLE stays ADD COLUMN flow_stage TEXT NOT NULL DEFAULT 'request';
ALTER TABLE mail_outbox ADD COLUMN payload TEXT;
CREATE TRIGGER no_overlapping_approved_stays BEFORE UPDATE OF status ON stays
WHEN NEW.status IN ('awaiting_payment','confirmed')
AND EXISTS(SELECT 1 FROM stays other WHERE other.id<>NEW.id AND other.status IN ('awaiting_payment','confirmed') AND NEW.arrival<other.departure AND other.arrival<NEW.departure)
BEGIN SELECT RAISE(ABORT,'Dates déjà bloquées'); END;
CREATE TABLE deposits (
 stay_id TEXT PRIMARY KEY REFERENCES stays(id),
 checkout_id TEXT UNIQUE,
 checkout_url TEXT,
 payment_intent_id TEXT UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('requested','authorized','released','captured','failed','expired','review')),
 capture_before TEXT,
 amount_cents INTEGER NOT NULL DEFAULT 30000 CHECK(amount_cents=30000),
 captured_cents INTEGER NOT NULL DEFAULT 0 CHECK(captured_cents BETWEEN 0 AND 30000)
);
