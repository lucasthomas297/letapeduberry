-- Only the authenticated owner may opt a pending personal request into Stripe test.
ALTER TABLE stays ADD COLUMN payment_test INTEGER NOT NULL DEFAULT 0 CHECK(payment_test IN (0,1));
CREATE TRIGGER immutable_payment_test BEFORE UPDATE OF payment_test ON stays
WHEN NEW.payment_test<>OLD.payment_test AND (OLD.status<>'pending' OR OLD.stripe_checkout_id IS NOT NULL OR OLD.contract_html IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Mode de paiement déjà fixé'); END;
