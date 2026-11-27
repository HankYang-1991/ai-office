#!/usr/bin/env python3
"""把 Hank 的 Claude / Gemini 訂閱用量寫進 data/subscriptions.json，內容有變才 commit + push。

用法：
  python3 scripts/publish_subscriptions.py
  python3 scripts/publish_subscriptions.py /workspace/ai-office-usage/usage.json
  python3 scripts/publish_subscriptions.py usage.json --dry-run    # 只印出，不寫檔
  python3 scripts/publish_subscriptions.py usage.json --no-push    # 只寫檔，不 commit/push

預設讀取 /workspace/ai-office-usage/usage.json（由 Grok Bot 每日 12:00、21:00 台北時間更新）。
只接受允許的欄位：百分比 0–100、帶時區的 ISO 8601 時間（轉成台北 +08:00）、短字串 ≤40 字；其餘欄位丟棄。
推送需要環境變數 AI_OFFICE_GITHUB_TOKEN（GitHub fine-grained token，ai-office repo Contents: write）。
"""
import argparse, datetime as dt, json, os, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "data" / "subscriptions.json"
DEFAULT_INPUT = Path("/workspace/ai-office-usage/usage.json")
TZ = dt.timezone(dt.timedelta(hours=8))  # Asia/Taipei
UPDATED_BY = "澳洲企鵝"
MAX_STR = 40

CLAUDE_FIELDS = (
    ("plan", "str"),
    ("session_pct", "pct"),
    ("session_note", "str"),
    ("weekly_pct", "pct"),
    ("weekly_reset", "time"),
    ("claude_code_weekly_pct", "pct"),
    ("status", "str"),
)
GEMINI_FIELDS = (
    ("plan", "str"),
    ("current_pct", "pct"),
    ("current_reset", "time"),
    ("weekly_pct", "pct"),
    ("weekly_reset", "time"),
)


class InputError(ValueError):
    pass


def die(msg):
    print(f"失敗：{msg}", file=sys.stderr)
    sys.exit(1)


def parse_time(v):
    if not isinstance(v, str):
        return None
    try:
        t = dt.datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def valid_pct(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        try:
            v = float(str(v).strip().replace("%", ""))
        except (ValueError, TypeError):
            return None
    v = float(v)
    if not (0 <= v <= 100):
        return None
    return int(v) if v == int(v) else round(v, 2)


def valid_str(v):
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not s or len(s) > MAX_STR:
        return None
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in s):
        return None
    return s


def fmt_time(t):
    return t.astimezone(TZ).replace(microsecond=0).isoformat()


def sanitize_field(kind, value, label):
    if kind == "pct":
        p = valid_pct(value)
        if p is None:
            raise InputError(f"{label} 必須是 0–100 的數字：{value!r}")
        return p
    if kind == "time":
        t = parse_time(value)
        if t is None:
            raise InputError(f"{label} 必須是帶時區的 ISO 8601 時間：{value!r}")
        return fmt_time(t)
    s = valid_str(value)
    if s is None:
        raise InputError(f"{label} 必須是不超過 {MAX_STR} 字的短字串：{value!r}")
    return s


def sanitize_plan(obj, fields, label):
    if not isinstance(obj, dict):
        raise InputError(f"{label} 必須是物件")
    out = {}
    for key, kind in fields:
        if key not in obj or obj[key] is None:
            continue
        out[key] = sanitize_field(kind, obj[key], f"{label}.{key}")
    if not any(kind == "pct" and key in out for key, kind in fields):
        raise InputError(f"{label} 至少要有一個有效的百分比欄位")
    return out


def sanitize(raw):
    if not isinstance(raw, dict):
        raise InputError("輸入必須是 JSON 物件")
    upd = parse_time(raw.get("updated_at"))
    if upd is None:
        raise InputError(f"updated_at 必須是帶時區的 ISO 8601 時間：{raw.get('updated_at')!r}")
    claude = sanitize_plan(raw.get("claude"), CLAUDE_FIELDS, "claude")
    gemini = sanitize_plan(raw.get("gemini"), GEMINI_FIELDS, "gemini")
    return {"updated_at": fmt_time(upd), "claude": claude, "gemini": gemini}


def dumps(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def git(*args, check=True):
    tok = os.environ.get("AI_OFFICE_GITHUB_TOKEN", "")
    helper = "!f() { echo username=x-access-token; echo \"password=$AI_OFFICE_GITHUB_TOKEN\"; }; f"
    cmd = ["git", "-C", str(REPO), "-c", "credential.helper=", "-c", f"credential.helper={helper}",
           "-c", f"user.name={UPDATED_BY}", "-c", "user.email=ai-office-bot@users.noreply.github.com", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        err = (r.stderr or r.stdout).strip()
        if tok:
            err = err.replace(tok, "***")
        die(f"git {' '.join(args)}：{err}")
    return r


def summary(data):
    c = data.get("claude") or {}
    g = data.get("gemini") or {}
    cw = c.get("weekly_pct")
    gw = g.get("weekly_pct")
    cw_s = f"{cw}%" if cw is not None else "—"
    gw_s = f"{gw}%" if gw is not None else "—"
    return f"Claude weekly {cw_s}, Gemini weekly {gw_s}"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", default=str(DEFAULT_INPUT),
                    help=f"來源 JSON 路徑（預設 {DEFAULT_INPUT}）")
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    path = Path(a.input)
    try:
        raw_text = path.read_text(encoding="utf-8")
        raw = json.loads(raw_text)
    except FileNotFoundError:
        die(f"找不到輸入檔：{path}")
    except Exception as e:
        die(f"讀不到輸入 JSON：{e}")
    try:
        data = sanitize(raw)
    except InputError as e:
        die(str(e))
    text = dumps(data)
    if a.dry_run:
        print(text, end="")
        return 0
    push = not a.no_push
    if push:
        if not os.environ.get("AI_OFFICE_GITHUB_TOKEN"):
            die("沒有設定 AI_OFFICE_GITHUB_TOKEN")
        git("pull", "--rebase", "--autostash", "--quiet", "origin", "main")
    old = None
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            old = None
    if old == data:
        print(f"沒有變化：{summary(data)}，未 commit")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    if not push:
        print(f"已寫入 {OUT}（未 push）：{summary(data)}")
        return 0
    git("add", "data/subscriptions.json")
    git("commit", "--quiet", "-m", f"Update subscriptions: {summary(data)}")
    git("push", "--quiet", "origin", "HEAD:main")
    sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"已更新並推送 {sha}：{summary(data)}，更新於 {data['updated_at']}")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
