ALTER TABLE mail_outbox RENAME TO mail_outbox_previous;
CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 stay_id TEXT NOT NULL REFERENCES stays(id),
 kind TEXT NOT NULL CHECK(kind IN ('owner_request','guest_acknowledgement','payment_link','confirmation','decision','deposit_link','payment_receipt','cancellation','refund_update','damage_notice','damage_receipt','damage_withdrawal','arrival_instructions','departure_reminder','stay_thanks','deposit_overdue','cash_deposit_received','cash_deposit_returned')),
 created_at TEXT NOT NULL,
 sent_at TEXT,
 provider_id TEXT,
 payload TEXT,
 UNIQUE(stay_id,kind)
);
INSERT INTO mail_outbox SELECT * FROM mail_outbox_previous;
DROP TABLE mail_outbox_previous;

CREATE TABLE cash_deposits (
 stay_id TEXT PRIMARY KEY REFERENCES stays(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents=30000),
 received_at TEXT NOT NULL, received_by TEXT NOT NULL,
 returned_at TEXT, returned_by TEXT,
 returned_cents INTEGER CHECK(returned_cents BETWEEN 0 AND 30000),
 retained_reason TEXT,
 CHECK((returned_at IS NULL AND returned_cents IS NULL) OR (returned_at IS NOT NULL AND returned_cents IS NOT NULL)),
 CHECK(returned_cents IS NULL OR returned_cents=30000 OR length(trim(retained_reason))>=3)
);
