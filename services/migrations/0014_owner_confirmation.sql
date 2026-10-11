ALTER TABLE mail_outbox RENAME TO mail_outbox_previous;
CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 stay_id TEXT NOT NULL REFERENCES stays(id),
 kind TEXT NOT NULL CHECK(kind IN ('owner_request','guest_acknowledgement','payment_link','confirmation','decision','deposit_link','payment_receipt','cancellation','refund_update','damage_notice','damage_receipt','damage_withdrawal','arrival_instructions','departure_reminder','stay_thanks','deposit_overdue','cash_deposit_received','cash_deposit_returned','owner_confirmation')),
 created_at TEXT NOT NULL,
 sent_at TEXT,
 provider_id TEXT,
 payload TEXT,
 UNIQUE(stay_id,kind)
);
INSERT INTO mail_outbox SELECT * FROM mail_outbox_previous;
DROP TABLE mail_outbox_previous;

-- Queue independently in the same transaction as the guest confirmation.
-- The unique stay/kind pair also covers Stripe retries and reconciliation.
CREATE TRIGGER queue_owner_confirmation AFTER INSERT ON mail_outbox
WHEN NEW.kind='confirmation'
BEGIN
 INSERT OR IGNORE INTO mail_outbox(id,stay_id,kind,created_at,payload)
 VALUES (NEW.id || '-owner',NEW.stay_id,'owner_confirmation',NEW.created_at,'{}');
END;
