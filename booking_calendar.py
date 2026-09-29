"""Calendrier des réservations directes et lecture des exports iCal externes."""

from __future__ import annotations

import datetime as dt
import re
import sqlite3
import uuid
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")


def iso_date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def _ical_date(value: str, key: str) -> dt.date:
    if re.fullmatch(r"\d{8}", value):
        return dt.datetime.strptime(value, "%Y%m%d").date()
    if value.endswith("Z"):
        instant = dt.datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
        return instant.astimezone(PARIS).date()
    instant = dt.datetime.strptime(value, "%Y%m%dT%H%M%S")
    tzid = re.search(r"(?:^|;)TZID=([^;:]+)", key)
    if tzid:
        instant = instant.replace(tzinfo=ZoneInfo(tzid.group(1)))
        return instant.astimezone(PARIS).date()
    return instant.date()


def parse_busy_ical(content: str) -> list[tuple[dt.date, dt.date]]:
    """Return half-open occupied date ranges. Unknown recurrence fails closed."""
    lines: list[str] = []
    for line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    events: list[dict[str, tuple[str, str]]] = []
    current: dict[str, tuple[str, str]] | None = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT" and current is not None:
            events.append(current)
            current = None
        elif current is not None and ":" in line:
            key, value = line.split(":", 1)
            name = key.split(";", 1)[0].upper()
            current[name] = (key, value)
    ranges = []
    for event in events:
        if event.get("STATUS", ("", ""))[1].upper() == "CANCELLED":
            continue
        if event.get("TRANSP", ("", ""))[1].upper() == "TRANSPARENT":
            continue
        if "RRULE" in event or "RDATE" in event:
            raise ValueError("Un événement iCal récurrent nécessite une vérification manuelle.")
        if "DTSTART" not in event:
            raise ValueError("Événement iCal sans date de début.")
        start = _ical_date(*reversed(event["DTSTART"]))
        end = _ical_date(*reversed(event["DTEND"])) if "DTEND" in event else start + dt.timedelta(days=1)
        if end <= start:
            end = start + dt.timedelta(days=1)
        ranges.append((start, end))
    return merge_ranges(ranges)


def merge_ranges(ranges: list[tuple[dt.date, dt.date]]) -> list[tuple[dt.date, dt.date]]:
    merged: list[list[dt.date]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def overlaps(start: dt.date, end: dt.date, busy: list[tuple[dt.date, dt.date]]) -> bool:
    return any(start < occupied_end and occupied_start < end for occupied_start, occupied_end in busy)


def init_database(path: str) -> None:
    with sqlite3.connect(path) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS reservations (
            id TEXT PRIMARY KEY,
            arrival TEXT NOT NULL,
            departure TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','confirmed','declined')),
            created_at TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS request_details (
            reservation_id TEXT PRIMARY KEY REFERENCES reservations(id),
            customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            guests INTEGER NOT NULL CHECK(guests IN (1,2)),
            rate TEXT NOT NULL CHECK(rate IN ('fixed','flex')),
            early_arrival INTEGER NOT NULL,
            late_departure INTEGER NOT NULL,
            total_eur INTEGER NOT NULL,
            payment_preference TEXT NOT NULL CHECK(payment_preference IN ('card','cash'))
        )""")


def price_stay(arrival: str, departure: str, rate: str, early: bool = False, late: bool = False) -> int:
    start, end = iso_date(arrival), iso_date(departure)
    if end <= start or (end - start).days > 60:
        raise ValueError("Dates de séjour invalides.")
    if rate not in {"fixed", "flex"}:
        raise ValueError("Tarif invalide.")
    amount = 0
    for n in range((end - start).days):
        weekday = (start + dt.timedelta(days=n)).weekday()
        amount += (75 if weekday in {4, 5} else 70) if rate == "fixed" else (84 if weekday in {4, 5} else 78)
    return amount + (5 if early else 0) + (5 if late else 0)


def add_booking_request(path: str, details: dict) -> str:
    arrival, departure = details["arrival"], details["departure"]
    total = price_stay(arrival, departure, details["rate"], details["early"], details["late"])
    identifier = uuid.uuid4().hex
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO reservations VALUES (?, ?, ?, 'pending', ?)",
                   (identifier, arrival, departure, dt.datetime.now(dt.timezone.utc).isoformat()))
        db.execute("INSERT INTO request_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   (identifier, details["name"], details["email"], details["phone"], details["guests"],
                    details["rate"], int(details["early"]), int(details["late"]), total, details["payment"]))
    return identifier


def confirmed_ranges(path: str) -> list[tuple[dt.date, dt.date]]:
    with sqlite3.connect(path) as db:
        rows = db.execute("SELECT arrival, departure FROM reservations WHERE status='confirmed'").fetchall()
    return [(iso_date(start), iso_date(end)) for start, end in rows]


def add_reservation(path: str, arrival: str, departure: str, status: str = "pending") -> str:
    start, end = iso_date(arrival), iso_date(departure)
    if end <= start:
        raise ValueError("Le départ doit suivre l’arrivée.")
    if status not in {"pending", "confirmed"}:
        raise ValueError("Statut invalide.")
    identifier = uuid.uuid4().hex
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO reservations VALUES (?, ?, ?, ?, ?)",
                   (identifier, arrival, departure, status, dt.datetime.now(dt.timezone.utc).isoformat()))
    return identifier


def reservation_dates(path: str, identifier: str) -> tuple[dt.date, dt.date]:
    with sqlite3.connect(path) as db:
        row = db.execute("SELECT arrival, departure FROM reservations WHERE id=? AND status='pending'", (identifier,)).fetchone()
    if not row:
        raise ValueError("Demande introuvable ou déjà traitée.")
    return iso_date(row[0]), iso_date(row[1])


def set_reservation_status(path: str, identifier: str, status: str) -> None:
    if status not in {"confirmed", "declined"}:
        raise ValueError("Statut invalide.")
    with sqlite3.connect(path) as db:
        result = db.execute("UPDATE reservations SET status=? WHERE id=? AND status='pending'", (status, identifier))
        if result.rowcount != 1:
            raise ValueError("Demande introuvable ou déjà traitée.")


def direct_calendar(path: str, now: dt.datetime | None = None) -> str:
    """Export only direct confirmed stays, without names or imported platform stays."""
    instant = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    stamp = instant.strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//L'Etape du Berry//Reservations directes//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Reservations directes - L'Etape du Berry"]
    with sqlite3.connect(path) as db:
        rows = db.execute("SELECT id, arrival, departure FROM reservations WHERE status='confirmed' ORDER BY arrival").fetchall()
    for identifier, start, end in rows:
        lines.extend(("BEGIN:VEVENT", f"UID:{identifier}@etapeduberry.direct", f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{start.replace('-', '')}", f"DTEND;VALUE=DATE:{end.replace('-', '')}", "SUMMARY:Indisponible", "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT"))
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
