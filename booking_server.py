"""Serveur du site et synchronisation iCal. Secrets fournis par variables d'environnement."""

from __future__ import annotations

import argparse
import datetime as dt
from email.message import EmailMessage
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from booking_calendar import (
    add_booking_request, add_reservation, confirmed_ranges, direct_calendar, init_database,
    merge_ranges, overlaps, parse_busy_ical, price_stay, reservation_dates, set_reservation_status,
)

ROOT = Path(__file__).resolve().parent
PAGES = {"/": "index.html", "/index.html": "index.html", "/appartement.html": "appartement.html",
         "/contact.html": "contact.html", "/photos.html": "photos.html", "/adresses.html": "adresses.html"}
TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript",
         ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2"}


def database_path() -> str:
    value = os.environ.get("BERRY_DB_PATH")
    if not value:
        raise RuntimeError("BERRY_DB_PATH doit pointer hors du dossier public du site.")
    path = Path(value).expanduser().resolve()
    if path == ROOT or ROOT in path.parents:
        raise RuntimeError("La base de données ne doit pas se trouver dans le dossier du site.")
    return str(path)


def busy_ranges() -> list[tuple[dt.date, dt.date]]:
    sources = (os.environ.get("BERRY_AIRBNB_ICAL"), os.environ.get("BERRY_BOOKING_ICAL"))
    if not all(sources):
        raise RuntimeError("Les deux calendriers externes doivent être configurés.")
    ranges = []
    for url in sources:
        if urlsplit(url).scheme != "https":
            raise RuntimeError("Un calendrier externe doit utiliser HTTPS.")
        request = Request(url, headers={"User-Agent": "LEtapeDuBerryCalendar/1.0"})
        with urlopen(request, timeout=12) as response:
            if response.status != 200:
                raise RuntimeError("Calendrier externe indisponible.")
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise RuntimeError("Calendrier externe trop volumineux.")
        content = data.decode("utf-8-sig")
        if "BEGIN:VCALENDAR" not in content:
            raise RuntimeError("Calendrier externe invalide.")
        ranges.extend(parse_busy_ical(content))
    ranges.extend(confirmed_ranges(database_path()))
    return merge_ranges(ranges)


def validate_request(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Demande invalide.")
    if raw.get("rulesAccepted") is not True:
        raise ValueError("Veuillez accepter le règlement intérieur avant d’envoyer votre demande.")
    details = {key: raw.get(key) for key in ("arrival", "departure", "rate", "name", "email", "phone", "guests", "payment")}
    if any(not isinstance(details[key], str) for key in ("arrival", "departure", "rate", "name", "email", "phone", "payment")):
        raise ValueError("Veuillez compléter les informations demandées.")
    details["name"] = details["name"].strip()
    details["email"] = details["email"].strip()
    details["phone"] = details["phone"].strip()
    if not (2 <= len(details["name"]) <= 100 and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", details["email"]) and 6 <= len(details["phone"]) <= 30):
        raise ValueError("Nom, e-mail ou téléphone invalide.")
    if details["guests"] not in (1, 2) or details["payment"] not in ("card", "cash"):
        raise ValueError("Voyageurs ou paiement invalide.")
    if not isinstance(raw.get("early"), bool) or not isinstance(raw.get("late"), bool):
        raise ValueError("Options invalides.")
    details["early"], details["late"] = raw["early"], raw["late"]
    start = dt.date.fromisoformat(details["arrival"])
    if start < dt.date.today() or start > dt.date.today() + dt.timedelta(days=365):
        raise ValueError("Date d’arrivée invalide.")
    price_stay(details["arrival"], details["departure"], details["rate"], details["early"], details["late"])
    details["rulesAccepted"] = True
    return details


def notify_owner(identifier: str, details: dict) -> None:
    required = ("BERRY_SMTP_HOST", "BERRY_SMTP_USER", "BERRY_SMTP_PASSWORD", "BERRY_SMTP_FROM")
    if not all(os.environ.get(key) for key in required):
        raise RuntimeError("Notification e-mail non configurée.")
    message = EmailMessage()
    message["Subject"] = f"Nouvelle demande de séjour — {identifier[:8]}"
    message["From"] = os.environ["BERRY_SMTP_FROM"]
    message["To"] = "lucas.thomas2@outlook.fr"
    message.set_content("\n".join((
        f"Référence : {identifier}", f"Arrivée : {details['arrival']}", f"Départ : {details['departure']}",
        f"Voyageurs : {details['guests']}", f"Tarif : {details['rate']}",
        f"Total : {price_stay(details['arrival'], details['departure'], details['rate'], details['early'], details['late'])} €",
        f"Arrivée anticipée : {'oui' if details['early'] else 'non'}",
        f"Départ tardif : {'oui' if details['late'] else 'non'}",
        f"Paiement souhaité : {details['payment']}",
        f"Nom : {details['name']}", f"E-mail : {details['email']}", f"Téléphone : {details['phone']}",
        "Règlement intérieur accepté par le voyageur (preuve horodatée conservée).",
        "Cette demande reste en attente de votre validation."
    )))
    with smtplib.SMTP(os.environ["BERRY_SMTP_HOST"], int(os.environ.get("BERRY_SMTP_PORT", "587")), timeout=12) as smtp:
        smtp.starttls()
        smtp.login(os.environ["BERRY_SMTP_USER"], os.environ["BERRY_SMTP_PASSWORD"])
        smtp.send_message(message)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        if self.path.startswith("/calendrier/direct/"):
            return  # Ne jamais inscrire le jeton privé du flux dans les journaux.
        super().log_message(format, *args)

    def send(self, status: int, content: bytes, kind: str, cache: str = "no-store") -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/status":
            ready = all(os.environ.get(key) for key in ("BERRY_AIRBNB_ICAL", "BERRY_BOOKING_ICAL", "BERRY_SMTP_HOST", "BERRY_SMTP_USER", "BERRY_SMTP_PASSWORD", "BERRY_SMTP_FROM"))
            try:
                database_path()
            except RuntimeError:
                ready = False
            self.send(200, json.dumps({"requests_ready": bool(ready)}).encode(), "application/json; charset=utf-8")
            return
        if path == "/api/availability":
            try:
                occupied = busy_ranges()
                body = json.dumps({"busy": [[start.isoformat(), end.isoformat()] for start, end in occupied]}).encode()
                self.send(200, body, "application/json; charset=utf-8")
            except Exception:
                self.send(503, b'{"error":"Calendrier momentanement indisponible"}', "application/json; charset=utf-8")
            return
        token = os.environ.get("BERRY_EXPORT_TOKEN", "")
        if path.startswith("/calendrier/direct/"):
            expected = f"/calendrier/direct/{token}.ics"
            if not token or len(token) < 32 or not secrets.compare_digest(path, expected):
                self.send(404, b"Introuvable", "text/plain; charset=utf-8")
                return
            try:
                body = direct_calendar(database_path()).encode("utf-8")
                self.send(200, body, "text/calendar; charset=utf-8", "private, no-store")
            except Exception:
                self.send(503, b"Calendrier indisponible", "text/plain; charset=utf-8")
            return
        name = PAGES.get(path)
        if not name and path.startswith("/assets/"):
            name = path.removeprefix("/")
        if not name:
            self.send(404, b"Introuvable", "text/plain; charset=utf-8")
            return
        file = (ROOT / name).resolve()
        if not file.is_relative_to(ROOT / "assets") and file.name not in PAGES.values():
            self.send(404, b"Introuvable", "text/plain; charset=utf-8")
            return
        if file.suffix not in TYPES or not file.is_file():
            self.send(404, b"Introuvable", "text/plain; charset=utf-8")
            return
        self.send(200, file.read_bytes(), TYPES[file.suffix] + ("; charset=utf-8" if file.suffix in {".html", ".css", ".js"} else ""))

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/request":
            self.send(404, b"Introuvable", "text/plain; charset=utf-8")
            return
        origin = self.headers.get("Origin", "")
        host = self.headers.get("Host", "")
        if origin and urlsplit(origin).netloc != host:
            self.send(403, b'{"error":"Origine interdite"}', "application/json; charset=utf-8")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 2 or size > 4096:
                raise ValueError("Demande trop volumineuse.")
            details = validate_request(json.loads(self.rfile.read(size)))
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            self.send(400, json.dumps({"error": str(error)}).encode(), "application/json; charset=utf-8")
            return
        try:
            if overlaps(dt.date.fromisoformat(details["arrival"]), dt.date.fromisoformat(details["departure"]), busy_ranges()):
                self.send(409, b'{"error":"Ces dates ne sont plus disponibles."}', "application/json; charset=utf-8")
                return
            identifier = add_booking_request(database_path(), details)
            try:
                notify_owner(identifier, details)
            except Exception:
                with sqlite3.connect(database_path()) as db:
                    db.execute("DELETE FROM request_consents WHERE reservation_id=?", (identifier,))
                    db.execute("DELETE FROM request_details WHERE reservation_id=?", (identifier,))
                    db.execute("DELETE FROM reservations WHERE id=?", (identifier,))
                raise
            self.send(201, json.dumps({"reference": identifier[:8]}).encode(), "application/json; charset=utf-8")
        except Exception:
            self.send(503, json.dumps({"error": "La demande n’a pas pu être envoyée. Réessayez plus tard."}).encode(), "application/json; charset=utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Calendrier direct de L’Étape du Berry")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8767)
    reserve = sub.add_parser("reserve")
    reserve.add_argument("arrival")
    reserve.add_argument("departure")
    status = sub.add_parser("status")
    status.add_argument("id")
    status.add_argument("decision", choices=["confirmed", "declined"])
    args = parser.parse_args()
    db = database_path()
    init_database(db)
    if args.command == "serve":
        ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    elif args.command == "reserve":
        print(add_reservation(db, args.arrival, args.departure))
    else:
        if args.decision == "confirmed":
            start, end = reservation_dates(db, args.id)
            if overlaps(start, end, busy_ranges()):
                raise ValueError("Ces dates ne sont plus disponibles ; confirmation refusée.")
        set_reservation_status(db, args.id, args.decision)


if __name__ == "__main__":
    main()
