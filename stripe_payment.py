"""Paiement Stripe Checkout, uniquement après validation d'un séjour direct."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def checkout_fields(reservation_id: str, email: str, amount_eur: int, label: str, base_url: str) -> dict[str, str]:
    if not reservation_id or amount_eur <= 0 or not base_url.startswith("https://"):
        raise ValueError("Paramètres de paiement invalides.")
    return {
        "mode": "payment",
        "payment_method_types[0]": "card",
        "client_reference_id": reservation_id,
        "customer_email": email,
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": str(amount_eur * 100),
        "line_items[0][price_data][product_data][name]": label,
        "line_items[0][quantity]": "1",
        "success_url": base_url.rstrip("/") + "/paiement.html?etat=retour",
        "cancel_url": base_url.rstrip("/") + "/paiement.html?etat=annule",
        "metadata[reservation_id]": reservation_id,
        "metadata[purpose]": "stay",
    }


def create_checkout_session(secret_key: str, fields: dict[str, str], reservation_id: str) -> dict:
    if not secret_key.startswith(("sk_test_", "sk_live_")):
        raise ValueError("Clé Stripe invalide.")
    request = Request("https://api.stripe.com/v1/checkout/sessions", data=urlencode(fields).encode(),
                      headers={"Authorization": f"Bearer {secret_key}",
                               "Content-Type": "application/x-www-form-urlencoded",
                               "Idempotency-Key": "berry-checkout-" + fields.get("metadata[purpose]", "stay") + "-" + reservation_id}, method="POST")
    with urlopen(request, timeout=15) as response:
        data = json.load(response)
    if not data.get("id") or not data.get("url", "").startswith("https://checkout.stripe.com/"):
        raise RuntimeError("Réponse Stripe inattendue.")
    return data


def verify_webhook(payload: bytes, signature: str, signing_secret: str, now: int | None = None) -> dict:
    """Vérifie la signature sur les octets bruts, puis décode l'événement."""
    if not signing_secret.startswith("whsec_"):
        raise ValueError("Secret de signature invalide.")
    parts = [part.strip().split("=", 1) for part in signature.split(",") if "=" in part]
    timestamp = next((value for key, value in parts if key == "t"), None)
    signatures = [value for key, value in parts if key == "v1"]
    if not timestamp or not timestamp.isdigit() or abs((now or int(time.time())) - int(timestamp)) > 300:
        raise ValueError("Signature Stripe expirée ou absente.")
    signed = timestamp.encode() + b"." + payload
    expected = hmac.new(signing_secret.encode(), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in signatures):
        raise ValueError("Signature Stripe incorrecte.")
    return json.loads(payload)


def deposit_checkout_fields(reservation_id: str, email: str, base_url: str) -> dict[str, str]:
    """Préparation d'une empreinte distincte du paiement ; à demander près de l'arrivée.

    Aucune session réelle n'est créée ici. L'intégration doit vérifier la date
    capture_before de la charge pour couvrir le séjour et le contrôle de sortie.
    """
    fields = checkout_fields(reservation_id, email, 300,
                             "Empreinte bancaire — dépôt de garantie de 300 €", base_url)
    fields.update({
        "payment_intent_data[capture_method]": "manual",
        "metadata[purpose]": "deposit",
        "payment_intent_data[metadata][purpose]": "deposit",
        "payment_intent_data[metadata][reservation_id]": reservation_id,
        "success_url": base_url.rstrip("/") + "/paiement.html?etat=retour-caution",
        "cancel_url": base_url.rstrip("/") + "/paiement.html?etat=caution-annulee",
    })
    return fields
