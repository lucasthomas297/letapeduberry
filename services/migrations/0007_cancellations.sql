CREATE TABLE cancellations (
 stay_id TEXT PRIMARY KEY REFERENCES stays(id),
 cause TEXT NOT NULL CHECK(cause IN ('guest','owner','exception','guarantee_refusal')),
 reason TEXT NOT NULL,
 notified_at TEXT NOT NULL,
 cancelled_at TEXT NOT NULL,
 owner_email TEXT NOT NULL,
 refund_cents INTEGER NOT NULL CHECK(refund_cents>=0),
 retained_cents INTEGER NOT NULL CHECK(retained_cents>=0),
 owed_cents INTEGER NOT NULL CHECK(owed_cents>=0),
 refund_status TEXT NOT NULL CHECK(refund_status IN ('none','pending','manual','succeeded','failed')),
 stripe_refund_id TEXT UNIQUE,
 refund_completed_at TEXT,
 deposit_done INTEGER NOT NULL DEFAULT 0 CHECK(deposit_done IN (0,1))
);
ALTER TABLE mail_outbox RENAME TO mail_outbox_previous;
CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 stay_id TEXT NOT NULL REFERENCES stays(id),
 kind TEXT NOT NULL CHECK(kind IN ('owner_request','guest_acknowledgement','payment_link','confirmation','decision','deposit_link','payment_receipt','cancellation','refund_update')),
 created_at TEXT NOT NULL,
 sent_at TEXT,
 provider_id TEXT,
 payload TEXT,
 UNIQUE(stay_id,kind)
);
INSERT INTO mail_outbox SELECT id,stay_id,kind,created_at,sent_at,provider_id,payload FROM mail_outbox_previous;
DROP TABLE mail_outbox_previous;
