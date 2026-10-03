import hashlib
import hmac
import json
import unittest

from stripe_payment import checkout_fields, deposit_checkout_fields, verify_webhook


class StripePaymentTests(unittest.TestCase):
    def test_checkout_uses_server_amount_after_approval(self):
        fields = checkout_fields("booking-123", "client@example.org", 225,
                                 "Séjour L’Étape du Berry", "https://example.org")
        self.assertEqual(fields["line_items[0][price_data][unit_amount]"], "22500")
        self.assertEqual(fields["client_reference_id"], "booking-123")
        self.assertEqual(fields["payment_method_types[0]"], "card")
        self.assertEqual(fields["mode"], "payment")

    def test_deposit_is_a_separate_300_euro_authorization(self):
        fields = deposit_checkout_fields("booking-123", "client@example.org", "https://example.org")
        self.assertEqual(fields["line_items[0][price_data][unit_amount]"], "30000")
        self.assertEqual(fields["payment_intent_data[capture_method]"], "manual")
        self.assertEqual(fields["metadata[purpose]"], "deposit")
        stay = checkout_fields("booking-123", "client@example.org", 225, "Séjour", "https://example.org")
        self.assertNotIn("payment_intent_data[capture_method]", stay)
        self.assertNotEqual(fields["metadata[purpose]"], stay["metadata[purpose]"])

    def test_webhook_rejects_tampering_and_replay(self):
        payload = json.dumps({"type": "checkout.session.completed", "id": "evt_test"}).encode()
        stamp = 1_780_000_000
        secret = "whsec_testsecret"
        digest = hmac.new(secret.encode(), str(stamp).encode() + b"." + payload, hashlib.sha256).hexdigest()
        signature = f"t={stamp},v1={digest}"
        self.assertEqual(verify_webhook(payload, signature, secret, now=stamp)["id"], "evt_test")
        with self.assertRaises(ValueError):
            verify_webhook(payload + b" ", signature, secret, now=stamp)
        with self.assertRaises(ValueError):
            verify_webhook(payload, signature, secret, now=stamp + 301)


if __name__ == "__main__":
    unittest.main()
