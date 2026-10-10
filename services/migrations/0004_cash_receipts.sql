-- Track the authenticated owner's cash acknowledgement separately from Stripe.
ALTER TABLE stays ADD COLUMN cash_received_by TEXT;
ALTER TABLE mail_outbox RENAME TO mail_outbox_previous;
CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 stay_id TEXT NOT NULL REFERENCES stays(id),
 kind TEXT NOT NULL CHECK(kind IN ('owner_request','guest_acknowledgement','payment_link','confirmation','decision','deposit_link','payment_receipt')),
 created_at TEXT NOT NULL,
 sent_at TEXT,
 provider_id TEXT,
 payload TEXT,
 UNIQUE(stay_id,kind)
);
INSERT INTO mail_outbox SELECT id,stay_id,kind,created_at,sent_at,provider_id,payload FROM mail_outbox_previous;
DROP TABLE mail_outbox_previous;
