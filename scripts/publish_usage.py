#!/usr/bin/env python3
"""把 Grok Bot 用量報告寫進 data/usage.json，內容有變才 commit + push。

用法：
  python3 scripts/publish_usage.py report.json
  echo '{"team_used_pct":22.5,"reset_at":"2026-11-07T23:44:00+08:00","shares":{"沼王小寶-攝影師":41}}' \
    | python3 scripts/publish_usage.py -
codex-小沼王 的 OpenAI Codex 獨立額度（不算在團隊額度內）：在輸入加 "codex": {...}，或用 --codex-file 路徑。
  {"agent":"codex-小沼王","provider":"openai-codex","plan":"Plus",
   "primary":{"window":"5h","used_pct":12.0,"reset_at":"...+08:00"},
   "secondary":{"window":"weekly","used_pct":34.0,"reset_at":"...+08:00"},
   "updated_at":"...+08:00","source":"..."}
  沒提供時沿用目前 data/usage.json 裡的 codex 資料（沒有則顯示尚未接上）。
選項：--no-push 只寫檔不 commit/push；--dry-run 只印出結果不寫檔。
推送需要環境變數 AI_OFFICE_GITHUB_TOKEN（GitHub fine-grained token，ai-office repo Contents: write）。
"""
import argparse, datetime as dt, json, os, re, subprocess, sys, unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
USAGE = REPO / "data" / "usage.json"
CONFIG = REPO / "js" / "config.js"
TZ = dt.timezone(dt.timedelta(hours=8))  # Asia/Taipei
UPDATED_BY = "澳洲企鵝"
PROVIDER = "grok-bot"
# 不在 Grok Bot 用量報告裡的 Agent（例如在 Hank 筆電上跑的 OpenAI Codex）
NOT_CONNECTED = {"codex-xiao-zhaowang": ("codex", "OpenAI Codex，在 Hank 的筆電上執行，尚未接上額度回報")}
CODEX_ID = "codex-xiao-zhaowang"
CODEX_NAME = "codex-小沼王"
STALE_HOURS = 24
# 報告名稱 → agent_id 的額外別名（自動比對失敗時才用）
ALIASES = {}


def die(msg):
    print(f"失敗：{msg}", file=sys.stderr)
    sys.exit(1)


def norm(s):
    s = unicodedata.normalize("NFKC", s)
    s = "".join(ch for ch in s if unicodedata.category(ch)[0] in "LN")  # 去掉空白、符號、emoji
    return s.lower()


def load_agents():
    text = CONFIG.read_text(encoding="utf-8")
    agents = re.findall(r"\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*role:\s*'([^']*)',\s*short:\s*'([^']+)'", text)
    if not agents:
        die(f"讀不到 {CONFIG} 裡的 agents")
    return [dict(id=i, name=n, role=r, short=s) for i, n, r, s in agents]


def map_name(report_name, agents):
    if report_name in ALIASES:
        return ALIASES[report_name]
    rn = norm(report_name)
    cands = []
    for a in agents:
        for key in (a["name"], a["short"]):
            k = norm(key)
            if k and rn.startswith(k):
                cands.append((len(k), a["id"]))
    return max(cands)[1] if cands else None


def parse_pct(v, what):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("%", "")
    if s.startswith("<"):
        return 0.5
    try:
        return float(s)
    except ValueError:
        die(f"{what} 不是數字：{v!r}")


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
    return round(v, 2) if 0 <= v <= 100 else None


def is_stale(updated_at, now):
    t = parse_time(updated_at)
    return t is None or (now - t).total_seconds() > STALE_HOURS * 3600


def codex_entries(obj, now):
    """把 Codex 用量物件轉成 entries；資料完全無效時回傳 None。"""
    if not isinstance(obj, dict):
        print("警告：codex 資料不是物件，略過", file=sys.stderr)
        return None
    upd_t = parse_time(obj.get("updated_at"))
    upd = upd_t.astimezone(TZ).isoformat() if upd_t else None
    prov = obj.get("provider") if isinstance(obj.get("provider"), str) and obj.get("provider").strip() else "openai-codex"
    plan = obj.get("plan") if isinstance(obj.get("plan"), str) else None
    src = obj.get("source") if isinstance(obj.get("source"), str) else None
    stale = is_stale(upd, now)
    out = []
    for key, default_win in (("primary", "5h"), ("secondary", "weekly")):
        w = obj.get(key)
        if not isinstance(w, dict):
            continue
        used = valid_pct(w.get("used_pct"))
        if used is None:
            if w.get("used_pct") is not None:
                print(f"警告：codex.{key}.used_pct 無效（{w.get('used_pct')!r}），略過", file=sys.stderr)
            continue
        win = w.get("window") if isinstance(w.get("window"), str) and w.get("window").strip() else default_win
        rt = parse_time(w.get("reset_at"))
        e = dict(agent_id=CODEX_ID, provider=prov, window=win.strip(), used=used, limit=100, unit="%",
                 reset_at=rt.astimezone(TZ).isoformat() if rt else None,
                 updated_at=upd or now.isoformat(), updated_by=CODEX_NAME, connected=True,
                 scope="own", stale=stale, slot=key,
                 note="OpenAI Codex 獨立額度（不算在團隊額度內）")
        if plan:
            e["plan"] = plan
        if src:
            e["source"] = src[:200]
        if not upd:
            e["updated_at_unknown"] = True
        out.append(e)
    if not out:
        print("警告：codex 資料沒有有效的 used_pct，略過", file=sys.stderr)
        return None
    return out


def previous_codex(old, now):
    if not isinstance(old, dict):
        return None
    prev = [e for e in old.get("entries", []) if isinstance(e, dict) and e.get("agent_id") == CODEX_ID and e.get("connected")]
    for e in prev:
        e["stale"] = True if e.get("updated_at_unknown") else is_stale(e.get("updated_at"), now)
    return prev or None


def build(report, agents, codex=None):
    team = parse_pct(report.get("team_used_pct"), "team_used_pct")
    reset_at = report.get("reset_at")
    try:
        dt.datetime.fromisoformat(reset_at)
    except Exception:
        die(f"reset_at 不是 ISO 8601 時間：{reset_at!r}")
    shares = report.get("shares")
    if not isinstance(shares, dict) or not shares:
        die("shares 必須是 {bot 名稱: 百分比} 物件")
    now_dt = dt.datetime.now(TZ).replace(microsecond=0)
    now = now_dt.isoformat()
    base = dict(provider=PROVIDER, window="weekly", limit=100, unit="%", reset_at=reset_at,
                updated_at=now, updated_by=UPDATED_BY)
    entries = [dict(agent_id="team", used=round(team, 2), scope="team",
                    note="整個團隊共用的 Grok Bot 每週額度", **base)]
    mapped, unmapped = {}, {}
    for rname, v in shares.items():
        p = parse_pct(v, f"shares[{rname}]")
        aid = map_name(rname, agents)
        if aid is None:
            unmapped[rname] = p
            print(f"警告：對不到 Agent 的名稱「{rname}」（{p}%），只記在 unmapped_shares", file=sys.stderr)
            continue
        if aid in mapped:
            mapped[aid]["share"] += p
            mapped[aid]["names"].append(rname)
        else:
            mapped[aid] = dict(share=p, names=[rname], raw=str(v))
    for a in agents:
        aid = a["id"]
        if aid in mapped:
            m = mapped[aid]
            share = round(m["share"], 2)
            entries.append(dict(agent_id=aid, used=round(share * team / 100, 2), share_pct=share,
                                share_label=m["raw"] if len(m["names"]) == 1 else f"{share:g}",
                                report_name=" / ".join(m["names"]), connected=True,
                                note=f"佔團隊 Grok Bot 用量 {m['raw'] if len(m['names']) == 1 else share}%；used = 佔團隊每週額度的百分比",
                                **base))
        elif aid == CODEX_ID and codex:
            entries.extend(codex)
        elif aid in NOT_CONNECTED:
            prov, note = NOT_CONNECTED[aid]
            entries.append(dict(agent_id=aid, provider=prov, window="weekly", used=0, limit=None, unit="%",
                                reset_at=None, updated_at=now, updated_by=UPDATED_BY, connected=False,
                                status="not_connected", note=note))
        else:
            entries.append(dict(agent_id=aid, used=0, share_pct=0, share_label="0", connected=True,
                                note="本週報告中沒有用量", **base))
    return dict(schema_version=1, is_demo=False, source="Grok Bot 用量報告（每小時更新）",
                generated_at=now, updated_by=UPDATED_BY,
                team=dict(provider=PROVIDER, window="weekly", used_pct=round(team, 2), limit=100, unit="%", reset_at=reset_at),
                unmapped_shares=unmapped, entries=entries)


def strip_ts(d):
    d = json.loads(json.dumps(d))
    d.pop("generated_at", None)
    for e in d.get("entries", []):
        if e.get("updated_by") == UPDATED_BY:  # codex 的 updated_at 來自它自己的檔案，要保留比對
            e.pop("updated_at", None)
    return d


def git(*args, check=True):
    tok = os.environ.get("AI_OFFICE_GITHUB_TOKEN", "")
    helper = "!f() { echo username=x-access-token; echo \"password=$AI_OFFICE_GITHUB_TOKEN\"; }; f"
    cmd = ["git", "-C", str(REPO), "-c", "credential.helper=", "-c", f"credential.helper={helper}",
           "-c", f"user.name={UPDATED_BY}", "-c", "user.email=ai-office-bot@users.noreply.github.com", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        die(f"git {' '.join(args)}：{(r.stderr or r.stdout).replace(tok, '***').strip() if tok else (r.stderr or r.stdout).strip()}")
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", default="-", help="報告 JSON 檔案路徑，或 - 代表 stdin")
    ap.add_argument("--codex-file", help="codex-小沼王 的 Codex 用量 JSON 檔（覆蓋輸入裡的 codex 欄位）")
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    try:
        raw = sys.stdin.read() if a.input == "-" else Path(a.input).read_text(encoding="utf-8")
        report = json.loads(raw)
    except Exception as e:
        die(f"讀不到輸入 JSON：{e}")
    push = not (a.no_push or a.dry_run)
    if push:
        if not os.environ.get("AI_OFFICE_GITHUB_TOKEN"):
            die("沒有設定 AI_OFFICE_GITHUB_TOKEN")
        git("pull", "--rebase", "--quiet", "origin", "main")
    if not isinstance(report, dict):
        die("輸入必須是 JSON 物件")
    codex_obj = report.get("codex")
    if a.codex_file:
        try:
            codex_obj = json.loads(Path(a.codex_file).read_text(encoding="utf-8"))
        except Exception as e:
            die(f"讀不到 --codex-file：{e}")
    old = None
    if USAGE.exists():
        try:
            old = json.loads(USAGE.read_text(encoding="utf-8"))
        except Exception:
            pass
    now_dt = dt.datetime.now(TZ).replace(microsecond=0)
    codex = codex_entries(codex_obj, now_dt) if codex_obj is not None else None
    codex_src = "新資料" if codex else None
    if codex is None:
        codex = previous_codex(old, now_dt)
        codex_src = "沿用上次" if codex else "尚未接上"
    data = build(report, load_agents(), codex)
    if a.dry_run:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        print(f"codex：{codex_src}", file=sys.stderr)
        return
    team = data["team"]["used_pct"]
    if old is not None and strip_ts(old) == strip_ts(data):
        print(f"沒有變化：團隊每週已用 {team}%，codex：{codex_src}，未 commit")
        return
    USAGE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not push:
        print(f"已寫入 {USAGE}（未 push）：團隊每週已用 {team}%，codex：{codex_src}")
        return
    git("add", "data/usage.json")
    git("commit", "--quiet", "-m", f"Update usage: team weekly {team}% used")
    git("push", "--quiet", "origin", "HEAD:main")
    sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"已更新並推送 {sha}：團隊每週已用 {team}%，重置 {data['team']['reset_at']}，{len(data['entries'])} 筆，codex：{codex_src}")


if __name__ == "__main__":
    main()
