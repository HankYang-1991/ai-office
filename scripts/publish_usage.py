#!/usr/bin/env python3
"""把 Grok Bot 用量報告寫進 data/usage.json，內容有變才 commit + push。

用法：
  python3 scripts/publish_usage.py report.json
  echo '{"team_used_pct":22.5,"reset_at":"2026-11-07T23:44:00+08:00","shares":{"沼王小寶-攝影師":41}}' \
    | python3 scripts/publish_usage.py -
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


def build(report, agents):
    team = parse_pct(report.get("team_used_pct"), "team_used_pct")
    reset_at = report.get("reset_at")
    try:
        dt.datetime.fromisoformat(reset_at)
    except Exception:
        die(f"reset_at 不是 ISO 8601 時間：{reset_at!r}")
    shares = report.get("shares")
    if not isinstance(shares, dict) or not shares:
        die("shares 必須是 {bot 名稱: 百分比} 物件")
    now = dt.datetime.now(TZ).replace(microsecond=0).isoformat()
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
    data = build(report, load_agents())
    if a.dry_run:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    old = None
    if USAGE.exists():
        try:
            old = json.loads(USAGE.read_text(encoding="utf-8"))
        except Exception:
            pass
    team = data["team"]["used_pct"]
    if old is not None and strip_ts(old) == strip_ts(data):
        print(f"沒有變化：團隊每週已用 {team}%，未 commit")
        return
    USAGE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not push:
        print(f"已寫入 {USAGE}（未 push）：團隊每週已用 {team}%")
        return
    git("add", "data/usage.json")
    git("commit", "--quiet", "-m", f"Update usage: team weekly {team}% used")
    git("push", "--quiet", "origin", "HEAD:main")
    sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"已更新並推送 {sha}：團隊每週已用 {team}%，重置 {data['team']['reset_at']}，{len(data['entries'])} 筆")


if __name__ == "__main__":
    main()
