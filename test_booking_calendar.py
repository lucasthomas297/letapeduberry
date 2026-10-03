import datetime as dt
import sqlite3
import tempfile
import unittest
from pathlib import Path

from booking_calendar import (
    add_booking_request, add_reservation, direct_calendar, init_database, overlaps, parse_busy_ical, price_stay,
    set_reservation_status,
)


class CalendarTests(unittest.TestCase):
    def test_import_merges_platform_stays_and_skips_cancellations(self):
        content = """BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261002
DTEND;VALUE=DATE:20261004
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261004
DTEND;VALUE=DATE:20261006
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261008
DTEND;VALUE=DATE:20261009
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR"""
        busy = parse_busy_ical(content)
        self.assertEqual(busy, [(dt.date(2026, 10, 2), dt.date(2026, 10, 6))])
        self.assertTrue(overlaps(dt.date(2026, 10, 3), dt.date(2026, 10, 4), busy))
        self.assertFalse(overlaps(dt.date(2026, 10, 6), dt.date(2026, 10, 7), busy))

    def test_export_only_confirmed_direct_stays(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "stays.sqlite")
            init_database(path)
            accepted = add_reservation(path, "2026-10-10", "2026-10-12")
            rejected = add_reservation(path, "2026-10-20", "2026-10-21")
            set_reservation_status(path, accepted, "confirmed")
            set_reservation_status(path, rejected, "declined")
            ics = direct_calendar(path, dt.datetime(2026, 9, 29, tzinfo=dt.timezone.utc))
            self.assertIn("DTSTART;VALUE=DATE:20261010", ics)
            self.assertIn("DTEND;VALUE=DATE:20261012", ics)
            self.assertNotIn("20261020", ics)
            self.assertEqual(ics.count("BEGIN:VEVENT"), 1)
            self.assertTrue(ics.endswith("END:VCALENDAR\r\n"))
            self.assertEqual(parse_busy_ical(ics), [(dt.date(2026, 10, 10), dt.date(2026, 10, 12))])

    def test_recurrence_refused_until_supported(self):
        content = "BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261010\nRRULE:FREQ=DAILY\nEND:VEVENT"
        with self.assertRaises(ValueError):
            parse_busy_ical(content)

    def test_price_and_pending_request(self):
        self.assertEqual(price_stay("2026-10-02", "2026-10-05", "fixed", True), 225)
        self.assertEqual(price_stay("2026-10-02", "2026-10-05", "flex", False, True), 251)
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "stays.sqlite")
            init_database(path)
            identifier = add_booking_request(path, {"arrival": "2026-10-02", "departure": "2026-10-05",
                "rate": "fixed", "early": True, "late": False, "name": "Test Client",
                "email": "client@example.org", "phone": "0102030405", "guests": 2, "payment": "cash", "rulesAccepted": True})
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute("SELECT status FROM reservations WHERE id=?", (identifier,)).fetchone()[0], "pending")
                self.assertEqual(db.execute("SELECT total_eur FROM request_details WHERE reservation_id=?", (identifier,)).fetchone()[0], 225)
                consent = db.execute("SELECT rules_version, accepted_at FROM request_consents WHERE reservation_id=?", (identifier,)).fetchone()
                self.assertEqual(consent[0], "2026-10-03")
                self.assertIsNotNone(dt.datetime.fromisoformat(consent[1]).tzinfo)
            self.assertEqual(direct_calendar(path).count("BEGIN:VEVENT"), 0)


if __name__ == "__main__":
    unittest.main()
