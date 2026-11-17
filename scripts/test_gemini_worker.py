#!/usr/bin/env python3
import datetime as dt
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gemini_worker as gw


class ClockTests(unittest.TestCase):
    def test_pacific_day_and_reset_before_4pm(self):
        now = dt.datetime(2026, 11, 18, 0, 55, tzinfo=gw.TZ)
        self.assertEqual(gw.pacific_day(now), "2026-11-17")
        self.assertEqual(gw.day_reset_at(now).isoformat(), "2026-11-18T16:00:00+08:00")

    def test_pacific_day_and_reset_after_4pm(self):
        now = dt.datetime(2026, 11, 18, 16, 0, tzinfo=gw.TZ)
        self.assertEqual(gw.pacific_day(now), "2026-11-18")
        self.assertEqual(gw.day_reset_at(now).isoformat(), "2026-11-19T16:00:00+08:00")


class SanitizeTests(unittest.TestCase):
    def sample(self):
        return {
            "model": "gemini-3.5-flash-lite",
            "requests_today": 2,
            "day_reset_at": "2026-11-18T16:00:00+08:00",
            "last_run_at": "2026-11-18T00:50:00+08:00",
            "last_status": "ok",
            "daily_cap": 300,
            "prompt": "SECRET",
            "output": "SECRET",
        }

    def test_allowlist_drops_secrets(self):
        out = gw.sanitize_public(self.sample())
        self.assertEqual(set(out), set(gw.PUBLIC_KEYS))
        self.assertNotIn("prompt", out)
        self.assertNotIn("output", json.dumps(out))
        self.assertEqual(out["requests_today"], 2)
        self.assertEqual(out["last_status"], "ok")

    def test_rejects_bad_fields(self):
        raw = self.sample()
        raw["requests_today"] = -1
        with self.assertRaises(gw.InputError):
            gw.sanitize_public(raw)
        raw = self.sample()
        raw["last_status"] = "ok; drop table"
        with self.assertRaises(gw.InputError):
            gw.sanitize_public(raw)
        raw = self.sample()
        raw["model"] = "gemini-3.5-flash-lite/../../etc"
        with self.assertRaises(gw.InputError):
            gw.sanitize_public(raw)


class RedactTests(unittest.TestCase):
    def test_redacts_key_and_header(self):
        key = "AIzaSyDummyTestKeyValue0000000000000"
        s = gw.redact(f"x-goog-api-key: {key} url?key={key}", key)
        self.assertNotIn(key, s)
        self.assertIn("***", s)


class _Resp:
    def __init__(self, code, body):
        self.status = code
        self._body = body if isinstance(body, bytes) else body.encode()
    def read(self):
        return self._body
    def getcode(self):
        return self.status
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


class CallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.local_dir = Path(self.tmp.name)
        self.local = self.local_dir / "usage-local.json"
        self.public = self.local_dir / "gemini.json"
        self.patches = [
            mock.patch.object(gw, "LOCAL_DIR", self.local_dir),
            mock.patch.object(gw, "LOCAL", self.local),
            mock.patch.object(gw, "PUBLIC", self.public),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def test_cap_blocks_request(self):
        now = dt.datetime(2026, 11, 18, 1, 0, tzinfo=gw.TZ)
        gw.save_local({"pacific_day": gw.pacific_day(now), "requests": 2, "max_per_day": 2,
                       "last_model": "gemini-3.5-flash-lite", "last_run_at": gw.fmt_time(now),
                       "last_status": "ok"})
        with mock.patch.object(gw, "now_taipei", return_value=now):
            opened = []
            def opener(*a, **k):
                opened.append(1)
                raise AssertionError("should not call API")
            rc = gw.main(["--max-per-day", "2", "1+1 等於多少？"], opener=opener, key_fn=lambda: "TESTKEY")
        self.assertEqual(rc, 2)
        self.assertEqual(opened, [])
        pub = json.loads(self.public.read_text())
        self.assertEqual(pub["requests_today"], 2)
        self.assertEqual(pub["last_status"], "rate_limited")
        self.assertNotIn("TESTKEY", self.public.read_text())
        self.assertNotIn("1+1", self.public.read_text())
        self.assertNotIn("TESTKEY", self.local.read_text())

    def test_fallback_404_then_ok(self):
        now = dt.datetime(2026, 11, 18, 1, 0, tzinfo=gw.TZ)
        calls = []
        def opener(req, timeout=None):
            calls.append(req.full_url)
            if "gemini-3.5-flash-lite" in req.full_url:
                raise __import__("urllib.error").error.HTTPError(req.full_url, 404, "no", hdrs=None, fp=io.BytesIO(b'{"error":"not found"}'))
            body = json.dumps({"candidates": [{"content": {"parts": [{"text": "418.4 A"}]}}]})
            return _Resp(200, body)
        with mock.patch.object(gw, "now_taipei", return_value=now):
            buf = io.StringIO()
            with mock.patch("sys.stdout", buf):
                rc = gw.main(["13.8kV 10MVA 線電流"], opener=opener, key_fn=lambda: "TESTKEY")
        self.assertEqual(rc, 0)
        self.assertEqual(len(calls), 2)
        self.assertIn("gemini-3.1-flash-lite", calls[1])
        self.assertIn("418.4 A", buf.getvalue())
        pub = json.loads(self.public.read_text())
        self.assertEqual(pub["model"], "gemini-3.1-flash-lite")
        self.assertEqual(pub["requests_today"], 2)  # 404 + success both count
        self.assertEqual(pub["last_status"], "ok")
        self.assertTrue(all("TESTKEY" not in u for u in calls))
        # header has key in the Request object but must not be in public/local files
        self.assertNotIn("TESTKEY", self.public.read_text() + self.local.read_text())

    def test_429_message_and_status(self):
        now = dt.datetime(2026, 11, 18, 1, 0, tzinfo=gw.TZ)
        def opener(req, timeout=None):
            raise __import__("urllib.error").error.HTTPError(
                req.full_url, 429, "quota", hdrs=None, fp=io.BytesIO(b'{"error":"quota"}'))
        err = io.StringIO()
        with mock.patch.object(gw, "now_taipei", return_value=now):
            with mock.patch("sys.stderr", err):
                rc = gw.main(["1+1"], opener=opener, key_fn=lambda: "TESTKEY")
        self.assertEqual(rc, 2)
        self.assertIn("免費額度", err.getvalue())
        self.assertIn("16:00", err.getvalue())
        self.assertNotIn("TESTKEY", err.getvalue())
        pub = json.loads(self.public.read_text())
        self.assertEqual(pub["last_status"], "rate_limited")
        # all three models tried
        self.assertEqual(pub["requests_today"], 3)


if __name__ == "__main__":
    unittest.main()
