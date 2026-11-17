#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from publish_subscriptions import (  # noqa: E402
    InputError, dumps, sanitize, valid_pct, valid_str,
)

SAMPLE = {
    "updated_at": "2026-11-17T23:37:00+08:00",
    "claude": {
        "plan": "Pro",
        "session_pct": 0,
        "session_note": "Starts with first message",
        "weekly_pct": 11,
        "weekly_reset": "2026-11-22T23:00:00+08:00",
        "claude_code_weekly_pct": 0,
        "status": "On track",
        "secret": "DROP_ME",
    },
    "gemini": {
        "plan": "Google AI Pro",
        "current_pct": 0,
        "current_reset": "2026-11-18T03:54:00+08:00",
        "weekly_pct": 0,
        "weekly_reset": "2026-11-24T10:54:00+08:00",
        "token": "nope",
    },
    "extra": {"ignore": True},
}


class SanitizeTests(unittest.TestCase):
    def test_sample_allowlist_and_types(self):
        out = sanitize(SAMPLE)
        self.assertEqual(out["updated_at"], "2026-11-17T23:37:00+08:00")
        self.assertEqual(out["claude"]["plan"], "Pro")
        self.assertEqual(out["claude"]["session_pct"], 0)
        self.assertEqual(out["claude"]["weekly_pct"], 11)
        self.assertEqual(out["claude"]["claude_code_weekly_pct"], 0)
        self.assertEqual(out["claude"]["status"], "On track")
        self.assertEqual(out["claude"]["weekly_reset"], "2026-11-22T23:00:00+08:00")
        self.assertNotIn("secret", out["claude"])
        self.assertNotIn("extra", out)
        self.assertNotIn("token", out["gemini"])
        self.assertEqual(out["gemini"]["plan"], "Google AI Pro")
        self.assertEqual(out["gemini"]["current_pct"], 0)
        self.assertIsInstance(out["claude"]["weekly_pct"], int)
        json.loads(dumps(out))

    def test_pct_out_of_range(self):
        raw = json.loads(json.dumps(SAMPLE))
        raw["claude"]["weekly_pct"] = 101
        with self.assertRaisesRegex(InputError, "0–100"):
            sanitize(raw)
        self.assertIsNone(valid_pct(-1))
        self.assertIsNone(valid_pct(100.01))
        self.assertEqual(valid_pct(100), 100)
        self.assertEqual(valid_pct("11.5%"), 11.5)

    def test_bool_not_pct(self):
        raw = json.loads(json.dumps(SAMPLE))
        raw["gemini"]["current_pct"] = True
        with self.assertRaisesRegex(InputError, "0–100"):
            sanitize(raw)
        self.assertIsNone(valid_pct(True))
        self.assertIsNone(valid_pct(False))

    def test_string_too_long_or_control(self):
        raw = json.loads(json.dumps(SAMPLE))
        raw["claude"]["plan"] = "P" * 41
        with self.assertRaisesRegex(InputError, "40"):
            sanitize(raw)
        raw["claude"]["plan"] = "Pro\nMax"
        with self.assertRaisesRegex(InputError, "短字串"):
            sanitize(raw)
        self.assertIsNone(valid_str(""))
        self.assertEqual(valid_str("  On track  "), "On track")

    def test_invalid_or_naive_datetime(self):
        raw = json.loads(json.dumps(SAMPLE))
        raw["updated_at"] = "2026-11-17 23:37:00"
        with self.assertRaisesRegex(InputError, "updated_at"):
            sanitize(raw)
        raw["updated_at"] = "2026-11-17T23:37:00+08:00"
        raw["claude"]["weekly_reset"] = "not-a-date"
        with self.assertRaisesRegex(InputError, "weekly_reset"):
            sanitize(raw)

    def test_zulu_converted_to_taipei(self):
        raw = json.loads(json.dumps(SAMPLE))
        raw["updated_at"] = "2026-11-17T15:37:00Z"
        out = sanitize(raw)
        self.assertEqual(out["updated_at"], "2026-11-17T23:37:00+08:00")

    def test_missing_required(self):
        raw = json.loads(json.dumps(SAMPLE))
        del raw["claude"]
        with self.assertRaisesRegex(InputError, "claude"):
            sanitize(raw)
        raw = json.loads(json.dumps(SAMPLE))
        raw["gemini"] = "nope"
        with self.assertRaisesRegex(InputError, "gemini"):
            sanitize(raw)
        raw = json.loads(json.dumps(SAMPLE))
        del raw["updated_at"]
        with self.assertRaisesRegex(InputError, "updated_at"):
            sanitize(raw)

    def test_optional_field_omitted(self):
        raw = json.loads(json.dumps(SAMPLE))
        del raw["claude"]["session_note"]
        del raw["claude"]["status"]
        out = sanitize(raw)
        self.assertNotIn("session_note", out["claude"])
        self.assertNotIn("status", out["claude"])
        self.assertEqual(out["claude"]["weekly_pct"], 11)

    def test_plan_needs_a_percent(self):
        raw = json.loads(json.dumps(SAMPLE))
        raw["gemini"] = {"plan": "Google AI Pro"}
        with self.assertRaisesRegex(InputError, "百分比"):
            sanitize(raw)

    def test_dry_run_main_no_write(self):
        from publish_subscriptions import main, OUT
        before = OUT.read_bytes() if OUT.exists() else None
        mtime = OUT.stat().st_mtime if OUT.exists() else None
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "usage.json"
            src.write_text(dumps(SAMPLE), encoding="utf-8")
            rc = main([str(src), "--dry-run"])
            self.assertEqual(rc, 0)
        after = OUT.read_bytes() if OUT.exists() else None
        after_mtime = OUT.stat().st_mtime if OUT.exists() else None
        self.assertEqual(before, after)
        self.assertEqual(mtime, after_mtime)


if __name__ == "__main__":
    unittest.main()
