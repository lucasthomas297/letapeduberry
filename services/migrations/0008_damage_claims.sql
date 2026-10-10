CREATE TABLE damage_claims (
 stay_id TEXT PRIMARY KEY REFERENCES stays(id),
 payment_intent_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 30000),
 reason TEXT NOT NULL,
 evidence TEXT NOT NULL,
 owner_email TEXT NOT NULL,
 created_at TEXT NOT NULL,
 capture_started_at TEXT,
 captured_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('prepared','capturing','captured','abandoned'))
);
ALTER TABLE mail_outbox RENAME TO mail_outbox_previous;
CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 stay_id TEXT NOT NULL REFERENCES stays(id),
 kind TEXT NOT NULL CHECK(kind IN ('owner_request','guest_acknowledgement','payment_link','confirmation','decision','deposit_link','payment_receipt','cancellation','refund_update','damage_notice','damage_receipt','damage_withdrawal')),
 created_at TEXT NOT NULL,
 sent_at TEXT,
 provider_id TEXT,
 payload TEXT,
 UNIQUE(stay_id,kind)
);
INSERT INTO mail_outbox SELECT * FROM mail_outbox_previous;
DROP TABLE mail_outbox_previous;
