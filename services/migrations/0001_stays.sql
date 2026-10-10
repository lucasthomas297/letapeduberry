-- Local preparation: no production database is created by this file.
CREATE TABLE stays (
 id TEXT PRIMARY KEY,
 request_key TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL,
 arrival TEXT NOT NULL,
 departure TEXT NOT NULL CHECK(departure > arrival),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','awaiting_payment','confirmed','declined','cancelled','expired')),
 customer_name TEXT NOT NULL,
 customer_email TEXT NOT NULL,
 customer_phone TEXT NOT NULL,
 guests INTEGER NOT NULL CHECK(guests IN (1,2)),
 rate TEXT NOT NULL CHECK(rate IN ('fixed','flex')),
 early_arrival INTEGER NOT NULL CHECK(early_arrival IN (0,1)),
 late_departure INTEGER NOT NULL CHECK(late_departure IN (0,1)),
 total_cents INTEGER NOT NULL CHECK(total_cents > 0),
 payment_preference TEXT NOT NULL CHECK(payment_preference IN ('card','cash')),
 rules_version TEXT NOT NULL,
 rules_accepted_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 payment_due_at TEXT,
 stripe_checkout_id TEXT UNIQUE,
 stripe_payment_intent_id TEXT UNIQUE
);
CREATE INDEX stays_dates ON stays(status,arrival,departure);
-- Stored alongside the request so an email failure does not erase the request.
CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 stay_id TEXT NOT NULL REFERENCES stays(id),
 kind TEXT NOT NULL CHECK(kind IN ('owner_request','guest_acknowledgement','payment_link','confirmation','decision','deposit_link')),
 created_at TEXT NOT NULL,
 sent_at TEXT,
 provider_id TEXT,
 UNIQUE(stay_id,kind)
);
CREATE TABLE stripe_events (
 id TEXT PRIMARY KEY,
 processed_at TEXT NOT NULL
);
