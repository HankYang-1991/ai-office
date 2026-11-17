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
import openai_worker as ow


def sample_public(**kw):
    d = {
        "model": "gpt-5.4-mini",
        "requests_today": 2,
        "spend_today_usd": 0.0012,
        "spend_month_usd": 1.25,
        "monthly_cap_usd": 95.0,
        "month_reset_at": "2026-12-01T00:00:00+08:00",
        "last_run_at": "2026-11-18T01:30:00+08:00",
        "last_status": "ok",
        "prompt": "SECRET",
        "output": "SECRET",
        "daily_cap_usd": 3.0,
    }
    d.update(kw)
    return d


class ClockTests(unittest.TestCase):
    def test_taipei_day_month_and_reset(self):
        now = dt.datetime(2026, 11, 18, 1, 30, tzinfo=ow.TZ)
        self.assertEqual(ow.taipei_day(now), "2026-11-18")
        self.assertEqual(ow.taipei_month(now), "2026-11")
        self.assertEqual(ow.month_reset_at(now).isoformat(), "2026-12-01T00:00:00+08:00")

    def test_month_reset_december(self):
        now = dt.datetime(2026, 12, 15, 23, 59, tzinfo=ow.TZ)
        self.assertEqual(ow.taipei_month(now), "2026-12")
        self.assertEqual(ow.month_reset_at(now).isoformat(), "2027-01-01T00:00:00+08:00")


class SanitizeTests(unittest.TestCase):
    def test_allowlist_drops_secrets_and_daily_cap(self):
        out = ow.sanitize_public(sample_public())
        self.assertEqual(set(out), set(ow.PUBLIC_KEYS))
        self.assertNotIn("prompt", out)
        self.assertNotIn("output", json.dumps(out))
        self.assertNotIn("daily_cap_usd", out)
        self.assertEqual(out["requests_today"], 2)
        self.assertEqual(out["spend_today_usd"], 0.0012)
        self.assertEqual(out["spend_month_usd"], 1.25)
        self.assertEqual(out["monthly_cap_usd"], 95.0)
        self.assertEqual(out["last_status"], "ok")

    def test_accepts_insufficient_quota(self):
        out = ow.sanitize_public(sample_public(last_status="insufficient_quota"))
        self.assertEqual(out["last_status"], "insufficient_quota")

    def test_rejects_bad_fields(self):
        with self.assertRaises(ow.InputError):
            ow.sanitize_public(sample_public(spend_month_usd=-1))
        with self.assertRaises(ow.InputError):
            ow.sanitize_public(sample_public(monthly_cap_usd=0))
        with self.assertRaises(ow.InputError):
            ow.sanitize_public(sample_public(last_status="ok; drop table"))
        with self.assertRaises(ow.InputError):
            ow.sanitize_public(sample_public(model="gpt-5.4-mini/../../etc"))
        with self.assertRaises(ow.InputError):
            ow.sanitize_public(sample_public(month_reset_at="2026-12-01"))


class PriceTests(unittest.TestCase):
    def test_default_is_official_flagship(self):
        self.assertEqual(ow.DEFAULT_MODEL, "gpt-6.2-astra")
        p = ow.price_for("gpt-6.2-astra")
        self.assertEqual(p, {"input": 8.00, "cached": 0.40, "output": 40.00})
        self.assertFalse(ow.allows_reasoning_none("gpt-6.2-astra"))
        body = ow.build_body("hi", "gpt-6.2-astra")
        self.assertEqual(body["model"], "gpt-6.2-astra")
        self.assertEqual(body["reasoning"]["effort"], "low")

    def test_known_and_snapshot(self):
        p = ow.price_for("gpt-5.4-mini")
        self.assertEqual(p["input"], 0.75)
        self.assertEqual(p["cached"], 0.075)
        self.assertEqual(p["output"], 4.50)
        self.assertEqual(ow.price_for("gpt-5.4-mini-2026-03-17"), p)
        self.assertIsNone(ow.price_for("mystery-model-9"))

    def test_cost_math(self):
        # 800 uncached in + 200 out at mini rates：0.75*800 + 4.50*200 = 1500 → $0.0015
        cost = ow.estimate_cost_usd("gpt-5.4-mini", 800, 200, 0)
        self.assertEqual(cost, 0.0015)
        # 含 cached：900 uncached + 100 cached + 200 out = (675 + 7.5 + 900) / 1e6 = 0.0015825 → 6 位小數
        self.assertEqual(ow.estimate_cost_usd("gpt-5.4-mini", 1000, 200, 100), 0.001582)
        # 旗艦 gpt-6.2-astra：1000 in + 200 out = (8*1000 + 40*200) / 1e6 = $0.016
        self.assertEqual(ow.estimate_cost_usd("gpt-6.2-astra", 1000, 200, 0), 0.016)


class RedactTests(unittest.TestCase):
    def test_redacts_key_and_bearer(self):
        key = "sk-proj-DummyTestKeyValue0000000000000000"
        s = ow.redact(f"Authorization: Bearer {key} raw={key}", key)
        self.assertNotIn(key, s)
        self.assertIn("***", s)
        self.assertNotIn("sk-proj-", s)


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


def ok_body(text="結論：可以。", inp=80, out=20, cached=0):
    return json.dumps({
        "output_text": text,
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": {
            "input_tokens": inp,
            "output_tokens": out,
            "input_tokens_details": {"cached_tokens": cached},
        },
    })


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.local_dir = Path(self.tmp.name)
        self.local = self.local_dir / "usage-local.json"
        self.public = self.local_dir / "openai.json"
        self.patches = [
            mock.patch.object(ow, "LOCAL_DIR", self.local_dir),
            mock.patch.object(ow, "LOCAL", self.local),
            mock.patch.object(ow, "PUBLIC", self.public),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def seed(self, now, **kw):
        base = {
            "taipei_day": ow.taipei_day(now),
            "taipei_month": ow.taipei_month(now),
            "requests_today": 1,
            "spend_today_usd": 0.5,
            "spend_month_usd": 10.0,
            "monthly_cap_usd": 95.0,
            "last_model": "gpt-5.4-mini",
            "last_run_at": ow.fmt_time(now),
            "last_status": "ok",
            "last_cost_usd": 0.1,
            "last_input_tokens": 10,
            "last_output_tokens": 5,
        }
        base.update(kw)
        ow.save_local(base)

    def test_monthly_cap_blocks_request(self):
        now = dt.datetime(2026, 11, 18, 1, 30, tzinfo=ow.TZ)
        self.seed(now, spend_month_usd=95.0, spend_today_usd=2.0, requests_today=4)
        opened = []
        def opener(*a, **k):
            opened.append(1)
            raise AssertionError("should not call API")
        err = io.StringIO()
        with mock.patch.object(ow, "now_taipei", return_value=now):
            with mock.patch("sys.stderr", err):
                rc = ow.main(["請摘要這句話"], opener=opener, key_fn=lambda: "sk-TESTKEY")
        self.assertEqual(rc, 2)
        self.assertEqual(opened, [])
        self.assertIn("硬上限", err.getvalue())
        self.assertIn("95", err.getvalue())
        self.assertFalse(self.public.exists())  # 本機上限拒絕不改公開檔
        loc = json.loads(self.local.read_text())
        self.assertEqual(loc["requests_today"], 4)
        self.assertEqual(loc["spend_month_usd"], 95.0)
        self.assertNotIn("sk-TESTKEY", self.local.read_text())
        self.assertNotIn("請摘要", self.local.read_text())

    def test_no_daily_spend_cap(self):
        now = dt.datetime(2026, 11, 18, 1, 30, tzinfo=ow.TZ)
        # 今日花費已很高，但本月仍低於 $95，應該放行
        self.seed(now, spend_today_usd=40.0, spend_month_usd=40.0, requests_today=9)
        def opener(req, timeout=None):
            return _Resp(200, ok_body("結論：沒問題。", inp=100, out=20))
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(ow, "now_taipei", return_value=now):
            with mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
                rc = ow.main(["一句話摘要：測試。"], opener=opener, key_fn=lambda: "sk-TESTKEY")
        self.assertEqual(rc, 0)
        self.assertIn("結論：沒問題。", out.getvalue())
        pub = json.loads(self.public.read_text())
        self.assertNotIn("daily_cap_usd", pub)
        self.assertEqual(pub["requests_today"], 10)
        self.assertGreater(pub["spend_today_usd"], 40.0)
        self.assertGreater(pub["spend_month_usd"], 40.0)
        self.assertEqual(pub["monthly_cap_usd"], 95.0)
        self.assertEqual(pub["last_status"], "ok")
        self.assertNotIn("sk-TESTKEY", self.public.read_text() + self.local.read_text())
        self.assertNotIn("一句話摘要", self.public.read_text() + self.local.read_text())

    def test_unpriced_refused_unless_flag(self):
        now = dt.datetime(2026, 11, 18, 1, 30, tzinfo=ow.TZ)
        opened = []
        def opener(*a, **k):
            opened.append(1)
            raise AssertionError("should not call")
        err = io.StringIO()
        with mock.patch.object(ow, "now_taipei", return_value=now):
            with mock.patch("sys.stderr", err):
                with self.assertRaises(SystemExit) as cm:
                    ow.main(["--model", "mystery-model-9", "你好"], opener=opener, key_fn=lambda: "sk-TESTKEY")
        self.assertEqual(cm.exception.code, 1)
        self.assertEqual(opened, [])
        self.assertIn("單價", err.getvalue())

        def opener_ok(req, timeout=None):
            return _Resp(200, ok_body("結論：好。", inp=10, out=5))
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(ow, "now_taipei", return_value=now):
            with mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
                rc = ow.main(["--allow-unpriced", "--model", "mystery-model-9", "你好"],
                             opener=opener_ok, key_fn=lambda: "sk-TESTKEY")
        self.assertEqual(rc, 0)
        self.assertIn("無法用每月金額上限保護", err.getvalue())
        pub = json.loads(self.public.read_text())
        self.assertEqual(pub["spend_today_usd"], 0.0)
        self.assertEqual(pub["model"], "mystery-model-9")

    def test_401_429_and_insufficient_quota(self):
        now = dt.datetime(2026, 11, 18, 1, 30, tzinfo=ow.TZ)
        cases = [
            (401, b'{"error":{"message":"invalid api key"}}', "金鑰無效", "error", 1),
            (429, b'{"error":{"message":"rate limit"}}', "限流", "rate_limited", 2),
            (429, b'{"error":{"type":"insufficient_quota","message":"exceeded your current quota"}}',
             "額度不足", "insufficient_quota", 2),
        ]
        for code, body, needle, status, rc_want in cases:
            self.public.unlink(missing_ok=True)
            self.local.unlink(missing_ok=True)
            def opener(req, timeout=None, _code=code, _body=body):
                raise __import__("urllib.error").error.HTTPError(
                    req.full_url, _code, "err", hdrs=None, fp=io.BytesIO(_body))
            err = io.StringIO()
            with mock.patch.object(ow, "now_taipei", return_value=now):
                with mock.patch("sys.stderr", err):
                    rc = ow.main(["工程推理檢查"], opener=opener, key_fn=lambda: "sk-TESTKEY")
            self.assertEqual(rc, rc_want, msg=status)
            self.assertIn(needle, err.getvalue(), msg=status)
            self.assertNotIn("sk-TESTKEY", err.getvalue())
            if status == "insufficient_quota":
                self.assertIn("用完", err.getvalue())
            pub = json.loads(self.public.read_text())
            self.assertEqual(pub["last_status"], status)
            self.assertEqual(pub["requests_today"], 1)
            self.assertNotIn("daily_cap_usd", pub)
            self.assertNotIn("工程推理", pub)

    def test_day_rollover_keeps_month_spend(self):
        now = dt.datetime(2026, 11, 18, 0, 5, tzinfo=ow.TZ)
        ow.save_local({
            "taipei_day": "2026-11-17",
            "taipei_month": "2026-11",
            "requests_today": 7,
            "spend_today_usd": 1.23,
            "spend_month_usd": 8.5,
            "monthly_cap_usd": 95.0,
            "last_model": "gpt-5.4-mini",
            "last_run_at": "2026-11-17T23:50:00+08:00",
            "last_status": "ok",
        })
        local = ow.load_local(now, monthly_cap=95)
        self.assertEqual(local["requests_today"], 0)
        self.assertEqual(local["spend_today_usd"], 0.0)
        self.assertEqual(local["spend_month_usd"], 8.5)

    def test_month_rollover_resets_month_spend(self):
        now = dt.datetime(2026, 12, 1, 0, 5, tzinfo=ow.TZ)
        ow.save_local({
            "taipei_day": "2026-11-30",
            "taipei_month": "2026-11",
            "requests_today": 3,
            "spend_today_usd": 0.4,
            "spend_month_usd": 80.0,
            "monthly_cap_usd": 95.0,
            "last_model": "gpt-5.4-mini",
            "last_run_at": "2026-11-30T23:50:00+08:00",
            "last_status": "ok",
        })
        local = ow.load_local(now, monthly_cap=95)
        self.assertEqual(local["requests_today"], 0)
        self.assertEqual(local["spend_today_usd"], 0.0)
        self.assertEqual(local["spend_month_usd"], 0.0)


if __name__ == "__main__":
    unittest.main()
