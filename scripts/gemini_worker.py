#!/usr/bin/env python3
"""Hank 的 AI 辦公室「Gemini 計算員」：在本機用 Gemini API 做簡單重複計算，並更新公開統計。

用法：
  python3 scripts/gemini_worker.py "任務文字"
  python3 scripts/gemini_worker.py --file input.txt
  python3 scripts/gemini_worker.py "任務文字" --json
  python3 scripts/gemini_worker.py "任務文字" --publish          # 呼叫後若統計有變才 commit + push
  python3 scripts/gemini_worker.py --publish                   # 不呼叫 API，只發布目前的 data/gemini.json

金鑰只從環境變數 GEMINI_API_KEY 讀取（會去掉首尾空白），不會寫入 repo、日誌或 JSON，也絕不會印出。
本機計數（每個太平洋日）存在 /workspace/ai-office-gemini/usage-local.json（不在 repo 內）。
公開檔 data/gemini.json 只含非敏感統計：model、requests_today、day_reset_at、last_run_at、last_status、daily_cap。
預設不推送；推送需要 AI_OFFICE_GITHUB_TOKEN，做法與 publish_usage.py 相同（先 pull --rebase）。
"""
import argparse, datetime as dt, json, os, re, sys, urllib.error, urllib.request
from pathlib import Path

# publish_subscriptions 同款：必要時延後 import 以避免測試循環
REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "data" / "gemini.json"
LOCAL_DIR = Path("/workspace/ai-office-gemini")
LOCAL = LOCAL_DIR / "usage-local.json"
TZ = dt.timezone(dt.timedelta(hours=8))          # Asia/Taipei
PACIFIC = dt.timezone(dt.timedelta(hours=-8))    # PST：午夜太平洋時間 = 台北 16:00
UPDATED_BY = "澳洲企鵝"
DEFAULT_CAP = 300
DEFAULT_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
)
API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
TIMEOUT = 90
MAX_STR = 40
SYSTEM = (
    "你是 Hank 的 AI 辦公室裡的「Gemini 計算員」。"
    "請精準處理簡單、重複的計算、單位換算與格式整理。"
    "用繁體中文（台灣）簡潔作答，先列出結果，再補必要說明。"
)
JSON_HINT = "請只輸出一個 JSON 物件，至少包含 result 欄位，必要時加上 unit、notes。"
STATUS_OK = "ok"
STATUS_RL = "rate_limited"
STATUS_ERR = "error"
PUBLIC_KEYS = ("model", "requests_today", "day_reset_at", "last_run_at", "last_status", "daily_cap")


class InputError(ValueError):
    pass


def die(msg, code=1):
    print(f"失敗：{msg}", file=sys.stderr)
    sys.exit(code)


def api_key():
    k = os.environ.get("GEMINI_API_KEY", "")
    k = k.strip() if isinstance(k, str) else ""
    if not k:
        die("沒有設定 GEMINI_API_KEY")
    return k


def redact(text, key=""):
    s = "" if text is None else str(text)
    if key:
        s = s.replace(key, "***")
    s = re.sub(r"(?i)(x-goog-api-key|api[_-]?key)([\"'\\s:=]+)[^\\s&\"']+", r"\1\2***", s)
    s = re.sub(r"(?i)([?&]key=)[^&\s]+", r"\1***", s)
    return s


def now_taipei():
    return dt.datetime.now(TZ).replace(microsecond=0)


def pacific_day(now=None):
    t = now or now_taipei()
    if t.tzinfo is None:
        t = t.replace(tzinfo=TZ)
    return t.astimezone(PACIFIC).date().isoformat()


def day_reset_at(now=None):
    """下一次免費額度重置（台北 16:00 = 太平洋時間午夜）。"""
    t = now or now_taipei()
    if t.tzinfo is None:
        t = t.replace(tzinfo=TZ)
    t = t.astimezone(TZ)
    today = t.replace(hour=16, minute=0, second=0, microsecond=0)
    return today if t < today else today + dt.timedelta(days=1)


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
    return v if v in (STATUS_OK, STATUS_RL, STATUS_ERR) else None


def valid_nonneg_int(v, lo=0, hi=100000):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != int(v):
        return None
    n = int(v)
    return n if lo <= n <= hi else None


def sanitize_public(raw):
    """只留下可公開的統計欄位；格式不對就失敗。"""
    if not isinstance(raw, dict):
        raise InputError("統計必須是 JSON 物件")
    model = valid_model(raw.get("model"))
    if not model:
        raise InputError(f"model 無效：{raw.get('model')!r}")
    reqs = valid_nonneg_int(raw.get("requests_today"))
    if reqs is None:
        raise InputError(f"requests_today 必須是 0 以上的整數：{raw.get('requests_today')!r}")
    cap = valid_nonneg_int(raw.get("daily_cap"), lo=1)
    if cap is None:
        raise InputError(f"daily_cap 必須是正整數：{raw.get('daily_cap')!r}")
    reset = parse_time(raw.get("day_reset_at"))
    if reset is None:
        raise InputError(f"day_reset_at 必須是帶時區的 ISO 8601：{raw.get('day_reset_at')!r}")
    last = parse_time(raw.get("last_run_at"))
    if last is None:
        raise InputError(f"last_run_at 必須是帶時區的 ISO 8601：{raw.get('last_run_at')!r}")
    status = valid_status(raw.get("last_status"))
    if not status:
        raise InputError(f"last_status 必須是 ok / rate_limited / error：{raw.get('last_status')!r}")
    return {
        "model": model,
        "requests_today": reqs,
        "day_reset_at": fmt_time(reset),
        "last_run_at": fmt_time(last),
        "last_status": status,
        "daily_cap": cap,
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


def load_local(now=None, cap=DEFAULT_CAP):
    now = now or now_taipei()
    day = pacific_day(now)
    raw = load_json(LOCAL, {}) or {}
    if not isinstance(raw, dict):
        raw = {}
    prev_day = raw.get("pacific_day")
    reqs = valid_nonneg_int(raw.get("requests"), lo=0, hi=1000000) or 0
    if prev_day != day:
        reqs = 0
    stored_cap = valid_nonneg_int(raw.get("max_per_day"), lo=1) or cap
    return {
        "pacific_day": day,
        "requests": reqs,
        "max_per_day": cap if cap else stored_cap,
        "last_model": valid_model(raw.get("last_model")) or "",
        "last_run_at": raw.get("last_run_at") or "",
        "last_status": valid_status(raw.get("last_status")) or "",
    }


def save_local(local):
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    # 本機檔也不放金鑰、提示或模型輸出
    safe = {
        "pacific_day": local["pacific_day"],
        "requests": int(local["requests"]),
        "max_per_day": int(local["max_per_day"]),
        "last_model": local.get("last_model") or "",
        "last_run_at": local.get("last_run_at") or "",
        "last_status": local.get("last_status") or "",
    }
    LOCAL.write_text(dumps(safe), encoding="utf-8")


def public_from(local, now=None):
    now = now or now_taipei()
    return sanitize_public({
        "model": local.get("last_model") or DEFAULT_MODELS[0],
        "requests_today": local["requests"],
        "day_reset_at": fmt_time(day_reset_at(now)),
        "last_run_at": local.get("last_run_at") or fmt_time(now),
        "last_status": local.get("last_status") or STATUS_ERR,
        "daily_cap": local["max_per_day"],
    })


def write_public(data):
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.write_text(dumps(sanitize_public(data)), encoding="utf-8")


def git(*args, check=True):
    tok = os.environ.get("AI_OFFICE_GITHUB_TOKEN", "")
    helper = "!f() { echo username=x-access-token; echo \"password=$AI_OFFICE_GITHUB_TOKEN\"; }; f"
    cmd = ["git", "-C", str(REPO), "-c", "credential.helper=", "-c", f"credential.helper={helper}",
           "-c", f"user.name={UPDATED_BY}", "-c", "user.email=ai-office-bot@users.noreply.github.com", *args]
    import subprocess
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        err = (r.stderr or r.stdout).strip()
        if tok:
            err = err.replace(tok, "***")
        die(f"git {' '.join(args)}：{err}")
    return r


def publish_public():
    if not PUBLIC.exists():
        die(f"找不到 {PUBLIC}，請先成功跑一次計算員")
    try:
        data = sanitize_public(json.loads(PUBLIC.read_text(encoding="utf-8")))
    except Exception as e:
        die(f"data/gemini.json 格式無效：{e}")
    if not os.environ.get("AI_OFFICE_GITHUB_TOKEN"):
        die("沒有設定 AI_OFFICE_GITHUB_TOKEN")
    git("pull", "--rebase", "--autostash", "--quiet", "origin", "main")
    old = None
    if PUBLIC.exists():
        try:
            old = sanitize_public(json.loads(PUBLIC.read_text(encoding="utf-8")))
        except Exception:
            old = None
    # pull 可能覆寫本地檔，若本地 data 已被覆蓋且與即將發布的相同則跳過
    # 這裡重新寫入本次要發布的內容（以磁碟上 pull 後再比較：若呼叫端已寫好檔，pull 可能失敗於髒工作樹）
    # 採用：若 old == data 則不 commit。
    if old == data:
        print(f"沒有變化：今日 {data['requests_today']} / {data['daily_cap']} 次，未 commit")
        return 0
    write_public(data)
    git("add", "data/gemini.json")
    git("commit", "--quiet", "-m",
        f"Update gemini usage: {data['requests_today']}/{data['daily_cap']} ({data['last_status']})")
    git("push", "--quiet", "origin", "HEAD:main")
    sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"已更新並推送 {sha}：今日 {data['requests_today']} / {data['daily_cap']} 次，重置 {data['day_reset_at']}")
    return 0


def publish_after_write():
    """工作樹已含新的 data/gemini.json 時使用（先 pull 會失敗），改為：若與 HEAD 不同才 commit+push。

    為避免和其他發布腳本搶工作樹，發布前先 stash 以外的變更是過頭了；這裡只 add 這一個檔。
    若 pull --rebase 因髒檔失敗，改走：commit 這個檔後再 pull --rebase 再 push。
    """
    if not os.environ.get("AI_OFFICE_GITHUB_TOKEN"):
        die("沒有設定 AI_OFFICE_GITHUB_TOKEN")
    try:
        data = sanitize_public(json.loads(PUBLIC.read_text(encoding="utf-8")))
    except Exception as e:
        die(f"data/gemini.json 格式無效：{e}")
    # 與 HEAD 中的內容比較
    r = git("show", "HEAD:data/gemini.json", check=False)
    head = None
    if r.returncode == 0:
        try:
            head = sanitize_public(json.loads(r.stdout))
        except Exception:
            head = None
    if head == data:
        print(f"沒有變化：今日 {data['requests_today']} / {data['daily_cap']} 次，未 commit")
        return 0
    # 先提交本地變更，再 rebase 推送，避免髒工作樹擋 pull
    git("add", "data/gemini.json")
    # 若其實沒有 staged 變更
    staged = git("diff", "--cached", "--quiet", "--", "data/gemini.json", check=False)
    if staged.returncode == 0:
        print(f"沒有變化：今日 {data['requests_today']} / {data['daily_cap']} 次，未 commit")
        return 0
    git("commit", "--quiet", "-m",
        f"Update gemini usage: {data['requests_today']}/{data['daily_cap']} ({data['last_status']})")
    git("pull", "--rebase", "--autostash", "--quiet", "origin", "main")
    git("push", "--quiet", "origin", "HEAD:main")
    sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"已更新並推送 {sha}：今日 {data['requests_today']} / {data['daily_cap']} 次，重置 {data['day_reset_at']}")
    return 0


def model_chain(preferred):
    first = valid_model(preferred) or DEFAULT_MODELS[0]
    out, seen = [], set()
    for m in (first, *DEFAULT_MODELS):
        if m not in seen:
            out.append(m)
            seen.add(m)
    return out


def build_body(prompt, as_json=False, max_output_tokens=1024):
    sys_text = SYSTEM + ((" " + JSON_HINT) if as_json else "")
    body = {
        "systemInstruction": {"parts": [{"text": sys_text}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": int(max_output_tokens)},
    }
    if as_json:
        body["generationConfig"]["responseMimeType"] = "application/json"
    return body


def extract_text(obj):
    cands = obj.get("candidates") if isinstance(obj, dict) else None
    if not cands:
        return None
    parts = (((cands[0] or {}).get("content") or {}).get("parts") or [])
    texts = [p.get("text") for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]
    text = "\n".join(texts).strip()
    return text or None


def http_post(url, body, key, opener=None):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "x-goog-api-key": key,
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


def call_gemini(prompt, models, key, as_json=False, opener=None, max_output_tokens=1024):
    """依序嘗試模型。回傳 dict: ok, model, text, status, http_code, error。"""
    last = {"ok": False, "model": models[0], "text": None, "status": STATUS_ERR, "http_code": None, "error": "未送出請求"}
    body = build_body(prompt, as_json=as_json, max_output_tokens=max_output_tokens)
    for model in models:
        url = f"{API_ROOT}/{model}:generateContent"
        code, raw, err = http_post(url, body, key, opener=opener)
        if code == 200:
            try:
                obj = json.loads(raw.decode("utf-8"))
            except Exception:
                last = {"ok": False, "model": model, "text": None, "status": STATUS_ERR, "http_code": code, "error": "回應不是 JSON"}
                continue
            text = extract_text(obj)
            if not text:
                last = {"ok": False, "model": model, "text": None, "status": STATUS_ERR, "http_code": code, "error": "回應沒有文字"}
                continue
            return {"ok": True, "model": model, "text": text, "status": STATUS_OK, "http_code": 200, "error": None}
        if code in (404, 429):
            last = {
                "ok": False,
                "model": model,
                "text": None,
                "status": STATUS_RL if code == 429 else STATUS_ERR,
                "http_code": code,
                "error": f"HTTP {code}",
            }
            continue
        msg = redact((err or raw or "請求失敗"), key)
        if isinstance(msg, bytes):
            msg = redact(msg.decode("utf-8", "replace"), key)
        last = {"ok": False, "model": model, "text": None, "status": STATUS_ERR, "http_code": code, "error": str(msg)[:200]}
        # 其他錯誤（401/400/5xx）不換模型也沒幫助時仍嘗試下一個 5xx
        if code and 500 <= int(code) < 600:
            continue
        break
    return last


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
    if len(text) > 8000:
        die("任務文字過長（上限 8000 字）")
    return text


def main(argv=None, opener=None, key_fn=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("task", nargs="?", help="任務文字")
    ap.add_argument("--file", help="從檔案讀取任務文字")
    ap.add_argument("--json", dest="as_json", action="store_true", help="要求模型以 JSON 作答")
    ap.add_argument("--model", default=DEFAULT_MODELS[0], help="優先使用的模型（失敗時再回退）")
    ap.add_argument("--max-per-day", type=int, default=DEFAULT_CAP, help=f"本機每日安全上限（預設 {DEFAULT_CAP}）")
    ap.add_argument("--max-output-tokens", type=int, default=1024, help="模型輸出上限（預設 1024）")
    ap.add_argument("--publish", action="store_true", help="統計有變才把 data/gemini.json commit + push")
    ap.add_argument("--no-write", action="store_true", help="只呼叫、不寫統計檔（測試用）")
    a = ap.parse_args(argv)

    if a.max_per_day is None or a.max_per_day < 1 or a.max_per_day > 100000:
        die("--max-per-day 必須是 1–100000 的整數")
    if a.max_output_tokens is None or a.max_output_tokens < 16 or a.max_output_tokens > 8192:
        die("--max-output-tokens 必須是 16–8192 的整數")

    # 只發布、不呼叫（先提交本地 data/gemini.json，再 pull --rebase + push，避免髒樹擋下）
    if a.publish and not a.task and not a.file:
        return publish_after_write()

    prompt = read_prompt(a)
    now = now_taipei()
    local = load_local(now, cap=a.max_per_day)
    local["max_per_day"] = a.max_per_day
    if local["requests"] >= a.max_per_day:
        reset = fmt_time(day_reset_at(now))
        print(
            f"已達本機安全上限（今日 {local['requests']} / {a.max_per_day} 次），未送出請求。"
            f"重置時間：{reset}（台北時間 16:00，對應太平洋時間午夜）。",
            file=sys.stderr,
        )
        local["last_status"] = STATUS_RL
        local["last_run_at"] = fmt_time(now)
        if not a.no_write:
            save_local(local)
            write_public(public_from(local, now))
            if a.publish:
                return publish_after_write()
        return 2

    key = (key_fn or api_key)()
    models = model_chain(a.model)
    # 每嘗試一個模型算一次請求，先預留
    result = None
    tried = 0
    remaining_models = list(models)
    used = []
    while remaining_models:
        if local["requests"] + 1 > a.max_per_day:
            print(
                f"已達本機安全上限（今日 {local['requests']} / {a.max_per_day} 次），未再改試其他模型。"
                f"重置時間：{fmt_time(day_reset_at(now))}。",
                file=sys.stderr,
            )
            if result is None:
                result = {"ok": False, "model": used[-1] if used else models[0], "text": None,
                          "status": STATUS_RL, "http_code": None, "error": "cap"}
            break
        model = remaining_models.pop(0)
        local["requests"] += 1
        tried += 1
        used.append(model)
        result = call_gemini(prompt, [model], key, as_json=a.as_json, opener=opener,
                             max_output_tokens=a.max_output_tokens)
        local["last_model"] = result["model"]
        local["last_run_at"] = fmt_time(now)
        local["last_status"] = result["status"]
        if result["ok"]:
            break
        if result["http_code"] in (404, 429) and remaining_models:
            print(f"模型 {model} 回傳 HTTP {result['http_code']}，改試下一個。", file=sys.stderr)
            continue
        break

    if not a.no_write:
        save_local(local)
        write_public(public_from(local, now))

    if result and result["ok"]:
        print(result["text"])
        print(
            f"完成：模型 {result['model']}，今日 {local['requests']} / {a.max_per_day} 次，"
            f"重置 {fmt_time(day_reset_at(now))}",
            file=sys.stderr,
        )
        if a.publish and not a.no_write:
            return publish_after_write()
        return 0

    status = (result or {}).get("status") or STATUS_ERR
    if status == STATUS_RL or (result and result.get("http_code") == 429):
        print(
            "今日 Gemini 免費額度已用完或暫時被限流，請等到重置時間"
            f"（{fmt_time(day_reset_at(now))}，台北時間 16:00，對應太平洋時間午夜）再試。",
            file=sys.stderr,
        )
        if a.publish and not a.no_write:
            publish_after_write()
        return 2

    err = redact((result or {}).get("error") or "未知錯誤", key if 'key' in dir() else "")
    print(f"呼叫 Gemini 失敗：{err}", file=sys.stderr)
    if a.publish and not a.no_write:
        publish_after_write()
    return 1


if __name__ == "__main__":
    sys.exit(main() or 0)
