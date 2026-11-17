#!/usr/bin/env python3
"""Hank 的 AI 辦公室「量化分析師」：在本機用 OpenAI API 做法報、線型、策略與交易所相關分析，並更新公開統計。

用法：
  python3 scripts/openai_worker.py "任務文字"
  python3 scripts/openai_worker.py --file input.txt
  python3 scripts/openai_worker.py "任務文字" --json
  python3 scripts/openai_worker.py "任務文字" --model gpt-6.2-astra
  python3 scripts/openai_worker.py "任務文字" --publish
  python3 scripts/openai_worker.py --publish                   # 不呼叫 API，只發布目前的 data/openai.json

金鑰只從環境變數 OPENAI_API_KEY 讀取（會去掉首尾空白），不會寫入 repo、日誌或 JSON，也絕不會印出。
本機花費（台北日／月）存在 /workspace/ai-office-openai/usage-local.json（不在 repo 內）。
沒有每日花費上限（仍追蹤並公開「今日花費」）；每月硬上限預設 95 美元（--max-per-month）。
公開檔 data/openai.json 只含非敏感統計，不含提示或輸出。
預設不推送；推送需要 AI_OFFICE_GITHUB_TOKEN，做法與 publish_usage.py 相同。

單價表來源（2026-11-18，標準方案、每 100 萬 tokens、美元）：
  https://developers.openai.com/api/docs/pricing
  以及 https://developers.openai.com/api/docs/models/gpt-5.4-mini 等模型頁
  （openai.com/api/pricing 目前是商業方案頁，API 單價以 developers 文件為準）
未知單價的模型會拒絕呼叫，除非加上 --allow-unpriced（此情況無法用金額上限保護，並以 0 記帳且在 stderr 警告）。
"""
import argparse, datetime as dt, json, os, re, sys, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "data" / "openai.json"
LOCAL_DIR = Path("/workspace/ai-office-openai")
LOCAL = LOCAL_DIR / "usage-local.json"
TZ = dt.timezone(dt.timedelta(hours=8))  # Asia/Taipei
UPDATED_BY = "澳洲企鵝"
DEFAULT_MODEL = "gpt-6.2-astra"
DEFAULT_MONTHLY_CAP = 95.0
API_URL = "https://api.openai.com/v1/responses"
TIMEOUT = 180
DEFAULT_REASONING = "low"
MAX_STR = 40
SYSTEM = (
    "你是 Hank 的 AI 辦公室裡的「量化分析師」，也是 Grok Bot 成員。"
    "請負責公司財報分析、技術線型、交易策略與回測，以及交易所串接相關的工程工作。"
    "用繁體中文（台灣）作答，先給結論，再補推論、數據與必要說明。"
    "請在適當處簡短註明：本回覆僅供研究與教育，不是投資建議，也不構成買賣任何金融商品的推薦。"
)
JSON_HINT = "請只輸出一個 JSON 物件，至少包含 result 欄位，必要時加上 notes。"
STATUS_OK = "ok"
STATUS_RL = "rate_limited"
STATUS_ERR = "error"
STATUS_QUOTA = "insufficient_quota"
PUBLIC_KEYS = (
    "model", "requests_today", "spend_today_usd", "spend_month_usd",
    "monthly_cap_usd", "month_reset_at", "last_run_at", "last_status",
)
# 標準方案、短上下文（≤272K）單價：美元 / 1,000,000 tokens（input、cached_input、output）
# 查自 2026-11-18：
#   https://developers.openai.com/api/docs/models  （現行旗艦：GPT-6.2 Astra）
#   https://developers.openai.com/api/docs/models/gpt-6.2-astra
#   https://developers.openai.com/api/docs/pricing
PRICES = {
    "gpt-6.2-astra": {"input": 8.00, "cached": 0.40, "output": 40.00},
    "gpt-6.2-sol":   {"input": 2.00, "cached": 0.10, "output": 10.00},
    "gpt-6-astra":   {"input": 10.00, "cached": 1.00, "output": 50.00},
    "gpt-6.1-sol":   {"input": 2.00, "cached": 0.10, "output": 10.00},
    "gpt-5.4-mini":  {"input": 0.75, "cached": 0.075, "output": 4.50},
    "gpt-5.4-nano":  {"input": 0.20, "cached": 0.02, "output": 1.25},
    "gpt-5.4":       {"input": 2.50, "cached": 0.25, "output": 15.00},
    "gpt-5.5":       {"input": 5.00, "cached": 0.50, "output": 30.00},
}
REASONING_CHOICES = ("none", "low", "medium", "high", "xhigh", "max")


class InputError(ValueError):
    pass


def die(msg, code=1):
    print(f"失敗：{msg}", file=sys.stderr)
    sys.exit(code)


def api_key():
    k = os.environ.get("OPENAI_API_KEY", "")
    k = k.strip() if isinstance(k, str) else ""
    if not k:
        die("沒有設定 OPENAI_API_KEY")
    return k


def redact(text, key=""):
    s = "" if text is None else str(text)
    if key:
        s = s.replace(key, "***")
    s = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s\"']+", r"\1***", s)
    s = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9._\-]+", r"\1***", s)
    s = re.sub(r"sk-[A-Za-z0-9_\-]+", "***", s)
    s = re.sub(r"(?i)(api[_-]?key)([\"'\\s:=]+)[^\s&\"']+", r"\1\2***", s)
    return s


def now_taipei():
    return dt.datetime.now(TZ).replace(microsecond=0)


def taipei_day(now=None):
    t = now or now_taipei()
    if t.tzinfo is None:
        t = t.replace(tzinfo=TZ)
    return t.astimezone(TZ).date().isoformat()


def taipei_month(now=None):
    t = now or now_taipei()
    if t.tzinfo is None:
        t = t.replace(tzinfo=TZ)
    t = t.astimezone(TZ)
    return f"{t.year:04d}-{t.month:02d}"


def month_reset_at(now=None):
    t = now or now_taipei()
    if t.tzinfo is None:
        t = t.replace(tzinfo=TZ)
    t = t.astimezone(TZ)
    if t.month == 12:
        nxt = t.replace(year=t.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        nxt = t.replace(month=t.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return nxt


def parse_time(v):
    if not isinstance(v, str):
        return None
    try:
        t = dt.datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def fmt_time(t):
    return t.astimezone(TZ).replace(microsecond=0).isoformat()


def valid_model(v):
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not s or len(s) > MAX_STR:
        return None
    if not re.fullmatch(r"[A-Za-z0-9._-]+", s):
        return None
    return s


def valid_status(v):
    return v if v in (STATUS_OK, STATUS_RL, STATUS_ERR, STATUS_QUOTA) else None


def valid_nonneg_int(v, lo=0, hi=1000000):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != int(v):
        return None
    n = int(v)
    return n if lo <= n <= hi else None


def valid_money(v, lo=0.0, hi=100000.0):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if not (lo <= float(v) <= hi):
        return None
    return round(float(v), 6)


def money(v):
    return round(max(0.0, float(v)), 6)


def price_for(model):
    """回傳 {input, cached, output} 或 None。快照名稱（例如 gpt-5.4-mini-2026-03-17）對應到基礎型號。"""
    name = valid_model(model) or ""
    if name in PRICES:
        return PRICES[name]
    m = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", name)
    if m in PRICES:
        return PRICES[m]
    # 較長名稱優先（gpt-5.4-mini 必須在 gpt-5.4 之前）
    keys = sorted(PRICES, key=len, reverse=True)
    for k in keys:
        if name == k or name.startswith(k + "-"):
            return PRICES[k]
    return None


def estimate_cost_usd(model, input_tokens, output_tokens, cached_tokens=0):
    p = price_for(model)
    if not p:
        return None
    cached = max(0, int(cached_tokens or 0))
    inp = max(0, int(input_tokens or 0))
    out = max(0, int(output_tokens or 0))
    billed_in = max(0, inp - cached)
    usd = (billed_in * p["input"] + cached * p["cached"] + out * p["output"]) / 1_000_000.0
    return money(usd)


def sanitize_public(raw):
    if not isinstance(raw, dict):
        raise InputError("統計必須是 JSON 物件")
    model = valid_model(raw.get("model"))
    if not model:
        raise InputError(f"model 無效：{raw.get('model')!r}")
    reqs = valid_nonneg_int(raw.get("requests_today"), lo=0, hi=1000000)
    if reqs is None:
        raise InputError(f"requests_today 必須是 0 以上的整數：{raw.get('requests_today')!r}")
    today = valid_money(raw.get("spend_today_usd"))
    if today is None:
        raise InputError(f"spend_today_usd 必須是 0 以上的數字：{raw.get('spend_today_usd')!r}")
    month = valid_money(raw.get("spend_month_usd"))
    if month is None:
        raise InputError(f"spend_month_usd 必須是 0 以上的數字：{raw.get('spend_month_usd')!r}")
    cap = valid_money(raw.get("monthly_cap_usd"), lo=0.01)
    if cap is None:
        raise InputError(f"monthly_cap_usd 必須是正數：{raw.get('monthly_cap_usd')!r}")
    reset = parse_time(raw.get("month_reset_at"))
    if reset is None:
        raise InputError(f"month_reset_at 必須是帶時區的 ISO 8601：{raw.get('month_reset_at')!r}")
    last = parse_time(raw.get("last_run_at"))
    if last is None:
        raise InputError(f"last_run_at 必須是帶時區的 ISO 8601：{raw.get('last_run_at')!r}")
    status = valid_status(raw.get("last_status"))
    if not status:
        raise InputError(f"last_status 必須是 ok / rate_limited / error / insufficient_quota：{raw.get('last_status')!r}")
    return {
        "model": model,
        "requests_today": reqs,
        "spend_today_usd": today,
        "spend_month_usd": month,
        "monthly_cap_usd": cap,
        "month_reset_at": fmt_time(reset),
        "last_run_at": fmt_time(last),
        "last_status": status,
    }


def dumps(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def load_json(path, default=None):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def load_local(now=None, monthly_cap=DEFAULT_MONTHLY_CAP):
    now = now or now_taipei()
    day, month = taipei_day(now), taipei_month(now)
    raw = load_json(LOCAL, {}) or {}
    if not isinstance(raw, dict):
        raw = {}
    reqs = valid_nonneg_int(raw.get("requests_today"), lo=0, hi=1000000) or 0
    spend_today = valid_money(raw.get("spend_today_usd")) or 0.0
    spend_month = valid_money(raw.get("spend_month_usd")) or 0.0
    if raw.get("taipei_day") != day:
        reqs, spend_today = 0, 0.0
    if raw.get("taipei_month") != month:
        spend_month = 0.0
        if raw.get("taipei_day") != day:
            reqs, spend_today = 0, 0.0
    return {
        "taipei_day": day,
        "taipei_month": month,
        "requests_today": reqs,
        "spend_today_usd": spend_today,
        "spend_month_usd": spend_month,
        "monthly_cap_usd": float(monthly_cap),
        "last_model": valid_model(raw.get("last_model")) or "",
        "last_run_at": raw.get("last_run_at") or "",
        "last_status": valid_status(raw.get("last_status")) or "",
        "last_cost_usd": valid_money(raw.get("last_cost_usd")) if raw.get("last_cost_usd") is not None else 0.0,
        "last_input_tokens": valid_nonneg_int(raw.get("last_input_tokens")) or 0,
        "last_output_tokens": valid_nonneg_int(raw.get("last_output_tokens")) or 0,
    }


def save_local(local):
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    safe = {
        "taipei_day": local["taipei_day"],
        "taipei_month": local["taipei_month"],
        "requests_today": int(local["requests_today"]),
        "spend_today_usd": money(local["spend_today_usd"]),
        "spend_month_usd": money(local["spend_month_usd"]),
        "monthly_cap_usd": money(local["monthly_cap_usd"]),
        "last_model": local.get("last_model") or "",
        "last_run_at": local.get("last_run_at") or "",
        "last_status": local.get("last_status") or "",
        "last_cost_usd": money(local.get("last_cost_usd") or 0),
        "last_input_tokens": int(local.get("last_input_tokens") or 0),
        "last_output_tokens": int(local.get("last_output_tokens") or 0),
    }
    LOCAL.write_text(dumps(safe), encoding="utf-8")


def public_from(local, now=None):
    now = now or now_taipei()
    return sanitize_public({
        "model": local.get("last_model") or DEFAULT_MODEL,
        "requests_today": local["requests_today"],
        "spend_today_usd": local["spend_today_usd"],
        "spend_month_usd": local["spend_month_usd"],
        "monthly_cap_usd": local["monthly_cap_usd"],
        "month_reset_at": fmt_time(month_reset_at(now)),
        "last_run_at": local.get("last_run_at") or fmt_time(now),
        "last_status": local.get("last_status") or STATUS_ERR,
    })


def write_public(data):
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.write_text(dumps(sanitize_public(data)), encoding="utf-8")


def git(*args, check=True):
    tok = os.environ.get("AI_OFFICE_GITHUB_TOKEN", "")
    helper = "!f() { echo username=x-access-token; echo \"password=$AI_OFFICE_GITHUB_TOKEN\"; }; f"
    import subprocess
    cmd = ["git", "-C", str(REPO), "-c", "credential.helper=", "-c", f"credential.helper={helper}",
           "-c", f"user.name={UPDATED_BY}", "-c", "user.email=ai-office-bot@users.noreply.github.com", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        err = (r.stderr or r.stdout).strip()
        if tok:
            err = err.replace(tok, "***")
        die(f"git {' '.join(args)}：{err}")
    return r


def publish_after_write():
    if not os.environ.get("AI_OFFICE_GITHUB_TOKEN"):
        die("沒有設定 AI_OFFICE_GITHUB_TOKEN")
    if not PUBLIC.exists():
        die(f"找不到 {PUBLIC}，請先成功跑一次分析師（或先寫入統計檔）")
    try:
        data = sanitize_public(json.loads(PUBLIC.read_text(encoding="utf-8")))
    except Exception as e:
        die(f"data/openai.json 格式無效：{e}")
    r = git("show", "HEAD:data/openai.json", check=False)
    head = None
    if r.returncode == 0:
        try:
            head = sanitize_public(json.loads(r.stdout))
        except Exception:
            head = None
    if head == data:
        print(f"沒有變化：本月 ${data['spend_month_usd']:.4f} / ${data['monthly_cap_usd']:g}，未 commit")
        return 0
    git("add", "data/openai.json")
    staged = git("diff", "--cached", "--quiet", "--", "data/openai.json", check=False)
    if staged.returncode == 0:
        print(f"沒有變化：本月 ${data['spend_month_usd']:.4f} / ${data['monthly_cap_usd']:g}，未 commit")
        return 0
    git("commit", "--quiet", "-m",
        f"Update openai usage: ${data['spend_month_usd']:.4f}/${data['monthly_cap_usd']:g} ({data['last_status']})")
    git("pull", "--rebase", "--quiet", "origin", "main")
    git("push", "--quiet", "origin", "HEAD:main")
    sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"已更新並推送 {sha}：今日 ${data['spend_today_usd']:.4f}，本月 ${data['spend_month_usd']:.4f} / ${data['monthly_cap_usd']:g}")
    return 0


def allows_reasoning_none(model):
    """官方文件：GPT-6.2 Astra 等會拒絕 reasoning.effort=none。"""
    name = (valid_model(model) or "").lower()
    if "astra" in name or name.startswith("gpt-6.2"):
        return False
    return True


def build_body(prompt, model, as_json=False, max_output_tokens=1024, reasoning_effort=DEFAULT_REASONING):
    effort = (reasoning_effort or DEFAULT_REASONING).strip().lower()
    body = {
        "model": model,
        "instructions": SYSTEM + ((" " + JSON_HINT) if as_json else ""),
        "input": prompt,
        "max_output_tokens": int(max_output_tokens),
        "reasoning": {"effort": effort},
    }
    if as_json:
        body["text"] = {"format": {"type": "json_object"}}
    return body


def extract_text(obj):
    if not isinstance(obj, dict):
        return None
    if isinstance(obj.get("output_text"), str) and obj["output_text"].strip():
        return obj["output_text"].strip()
    texts = []
    for item in obj.get("output") or []:
        if not isinstance(item, dict):
            continue
        for c in item.get("content") or []:
            if not isinstance(c, dict):
                continue
            if c.get("type") in ("output_text", "text") and isinstance(c.get("text"), str):
                texts.append(c["text"])
    text = "\n".join(texts).strip()
    return text or None


def parse_usage(obj):
    u = obj.get("usage") if isinstance(obj, dict) else None
    if not isinstance(u, dict):
        return 0, 0, 0
    inp = u.get("input_tokens")
    out = u.get("output_tokens")
    cached = (u.get("input_tokens_details") or {}).get("cached_tokens") if isinstance(u.get("input_tokens_details"), dict) else 0
    if inp is None:
        inp = u.get("prompt_tokens") or 0
        out = u.get("completion_tokens") or 0
        det = u.get("prompt_tokens_details") or {}
        cached = det.get("cached_tokens") if isinstance(det, dict) else 0
    return int(inp or 0), int(out or 0), int(cached or 0)


def error_kind(code, raw):
    text = ""
    try:
        text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
    except Exception:
        text = ""
    low = text.lower()
    if code == 401:
        return STATUS_ERR, "401"
    if code == 429:
        if "insufficient_quota" in low or "exceeded your current quota" in low:
            return STATUS_QUOTA, "insufficient_quota"
        return STATUS_RL, "429"
    if "insufficient_quota" in low or "exceeded your current quota" in low:
        return STATUS_QUOTA, "insufficient_quota"
    return STATUS_ERR, f"HTTP {code}" if code else "error"


def format_api_error(status, code):
    if code == "401" or (code == 401):
        return "OpenAI API 金鑰無效或無權限（HTTP 401），請檢查本機 OPENAI_API_KEY。"
    if status == STATUS_RL:
        return "OpenAI API 目前被限流（HTTP 429），請稍後再試。"
    if status == STATUS_QUOTA:
        return "OpenAI API 額度不足（insufficient_quota）。若這是 ChatGPT Pro 附帶的 API 點數，可能已經用完。"
    return None


def http_post(url, body, key, opener=None):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
            "Accept": "application/json",
        },
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            code = getattr(resp, "status", None) or resp.getcode()
            return code, raw, None
    except urllib.error.HTTPError as e:
        raw = e.read() if e.fp else b""
        return e.code, raw, e
    except Exception as e:
        return None, b"", e


def call_openai(prompt, model, key, as_json=False, opener=None, max_output_tokens=1024, reasoning_effort=DEFAULT_REASONING):
    body = build_body(prompt, model, as_json=as_json, max_output_tokens=max_output_tokens, reasoning_effort=reasoning_effort)
    code, raw, err = http_post(API_URL, body, key, opener=opener)
    if code == 200:
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            return {"ok": False, "model": model, "text": None, "status": STATUS_ERR,
                    "http_code": code, "error": "回應不是 JSON", "usage": (0, 0, 0), "cost": None}
        text = extract_text(obj)
        usage = parse_usage(obj)
        cost = estimate_cost_usd(model, *usage)
        if not text:
            return {"ok": False, "model": model, "text": None, "status": STATUS_ERR,
                    "http_code": code, "error": "回應沒有文字", "usage": usage, "cost": cost}
        return {"ok": True, "model": model, "text": text, "status": STATUS_OK,
                "http_code": 200, "error": None, "usage": usage, "cost": cost}
    status, kind = error_kind(code, raw)
    msg = format_api_error(status, "401" if code == 401 else kind) or redact(raw.decode("utf-8", "replace") if raw else (str(err) if err else "請求失敗"), key)
    return {"ok": False, "model": model, "text": None, "status": status,
            "http_code": code, "error": str(msg)[:400], "usage": (0, 0, 0), "cost": None}


def guess_input_tokens(prompt):
    # 粗估：約 4 字元 1 token（含系統提示）
    n = len(SYSTEM) + len(prompt or "")
    return max(16, (n + 3) // 4)


def read_prompt(args):
    if args.file:
        try:
            text = Path(args.file).read_text(encoding="utf-8")
        except Exception as e:
            die(f"讀不到 --file：{e}")
    else:
        text = args.task or ""
    text = text.strip()
    if not text:
        die("請提供任務文字，或用 --file 指定檔案")
    if len(text) > 20000:
        die("任務文字過長（上限 20000 字）")
    return text


def main(argv=None, opener=None, key_fn=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("task", nargs="?", help="任務文字")
    ap.add_argument("--file", help="從檔案讀取任務文字")
    ap.add_argument("--json", dest="as_json", action="store_true", help="要求模型以 JSON 作答")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"模型（預設 {DEFAULT_MODEL}，現行官方旗艦）")
    ap.add_argument("--reasoning-effort", default=DEFAULT_REASONING, dest="reasoning_effort",
                    help=f"推理強度（預設 {DEFAULT_REASONING}；gpt-6.2-astra 不接受 none）")
    ap.add_argument("--max-per-month", type=float, default=DEFAULT_MONTHLY_CAP,
                    help=f"本機每月花費硬上限，美元（預設 {DEFAULT_MONTHLY_CAP:g}；沒有每日上限）")
    ap.add_argument("--allow-unpriced", action="store_true",
                    help="允許呼叫單價表沒有的模型（花費以 0 記帳，無法受金額上限保護）")
    ap.add_argument("--max-output-tokens", type=int, default=1024)
    ap.add_argument("--publish", action="store_true", help="統計有變才把 data/openai.json commit + push")
    ap.add_argument("--no-write", action="store_true", help="只呼叫、不寫統計檔（測試用）")
    a = ap.parse_args(argv)

    if a.max_per_month is None or a.max_per_month <= 0 or a.max_per_month > 100000:
        die("--max-per-month 必須是正數（美元）")
    if a.max_output_tokens is None or a.max_output_tokens < 16 or a.max_output_tokens > 8192:
        die("--max-output-tokens 必須是 16–8192 的整數")
    model = valid_model(a.model)
    if not model:
        die(f"model 無效：{a.model!r}")
    effort = (a.reasoning_effort or DEFAULT_REASONING).strip().lower()
    if effort not in REASONING_CHOICES:
        die(f"--reasoning-effort 必須是 {' / '.join(REASONING_CHOICES)}")
    if effort == "none" and not allows_reasoning_none(model):
        die(f"模型 {model} 不接受 reasoning.effort=none（官方文件寫明會拒絕），請改用 low 以上。")

    if a.publish and not a.task and not a.file:
        return publish_after_write()

    prompt = read_prompt(a)
    now = now_taipei()
    local = load_local(now, monthly_cap=a.max_per_month)
    local["monthly_cap_usd"] = float(a.max_per_month)

    priced = price_for(model)
    if not priced and not a.allow_unpriced:
        die(f"不知道模型 {model} 的單價，已拒絕呼叫。請改用價目表內的模型，或加上 --allow-unpriced（無法用金額上限保護）。")

    # 沒有每日上限；只在本月花費會超過每月硬上限時拒絕
    if local["spend_month_usd"] >= a.max_per_month:
        print(
            f"已達本月花費硬上限（本月 ${local['spend_month_usd']:.4f} / ${a.max_per_month:g}），未送出請求。"
            f"下月重置：{fmt_time(month_reset_at(now))}（台北時間）。",
            file=sys.stderr,
        )
        return 2

    if priced:
        est_in = guess_input_tokens(prompt)
        est = estimate_cost_usd(model, est_in, a.max_output_tokens, 0)
        if est is not None and local["spend_month_usd"] + est > a.max_per_month:
            remain = max(0.0, a.max_per_month - local["spend_month_usd"])
            print(
                f"此次預估花費約 ${est:.4f}，加上本月已用 ${local['spend_month_usd']:.4f} 會超過每月硬上限 ${a.max_per_month:g}"
                f"（剩餘約 ${remain:.4f}），未送出請求。下月重置：{fmt_time(month_reset_at(now))}。",
                file=sys.stderr,
            )
            return 2
    else:
        print("警告：此模型不在單價表內，花費以 $0 記帳，無法用每月金額上限保護此次呼叫。", file=sys.stderr)

    key = (key_fn or api_key)()
    result = call_openai(prompt, model, key, as_json=a.as_json, opener=opener,
                         max_output_tokens=a.max_output_tokens, reasoning_effort=effort)
    cost = result.get("cost")
    if cost is None:
        cost = 0.0 if a.allow_unpriced else 0.0
    inp, out, cached = result.get("usage") or (0, 0, 0)
    local["requests_today"] = int(local["requests_today"]) + 1
    local["spend_today_usd"] = money(local["spend_today_usd"] + (cost or 0))
    local["spend_month_usd"] = money(local["spend_month_usd"] + (cost or 0))
    local["last_model"] = result.get("model") or model
    local["last_run_at"] = fmt_time(now)
    local["last_status"] = result.get("status") or STATUS_ERR
    local["last_cost_usd"] = money(cost or 0)
    local["last_input_tokens"] = inp
    local["last_output_tokens"] = out

    if not a.no_write:
        save_local(local)
        write_public(public_from(local, now))

    if result and result["ok"]:
        print(result["text"])
        print(
            f"完成：模型 {result['model']}，此次約 ${money(cost or 0):.6f}"
            f"（input {inp} / cached {cached} / output {out} tokens），"
            f"今日 ${local['spend_today_usd']:.4f}，本月 ${local['spend_month_usd']:.4f} / ${a.max_per_month:g}",
            file=sys.stderr,
        )
        if a.publish and not a.no_write:
            return publish_after_write()
        return 0

    status = (result or {}).get("status") or STATUS_ERR
    friendly = format_api_error(status, "401" if result and result.get("http_code") == 401 else status)
    if friendly:
        print(friendly, file=sys.stderr)
    else:
        err = redact((result or {}).get("error") or "未知錯誤", key if "key" in dir() else "")
        print(f"呼叫 OpenAI 失敗：{err}", file=sys.stderr)
    if a.publish and not a.no_write:
        publish_after_write()
    return 2 if status in (STATUS_RL, STATUS_QUOTA) else 1


if __name__ == "__main__":
    sys.exit(main() or 0)
