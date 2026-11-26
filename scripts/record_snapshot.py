#!/usr/bin/env python3
"""把目前 data/*.json 的額度狀態存成一筆精簡快照，附加到 data/history.json（網站「今日時間軸」回放用）。

只讀 data/usage.json、subscriptions.json、gemini.json、openai.json、chat.json，不呼叫 API、不碰金鑰。
- 每筆快照：時間、各池已用 %、OpenAI 今日／本月花費、近期活躍 agent、團隊前 3 大用量，以及回放需要的精簡原始值
- 只保留最近 48 小時；與上一筆相差不到 --min-gap-min 分鐘（預設 20）就覆蓋上一筆，不重複堆疊
- openai_daily：每天 OpenAI 花費（取當天看到的最大值，保留 35 天），給 check_alerts.py 算 7 日平均

用法：
  python3 scripts/record_snapshot.py               # 只寫 data/history.json
  python3 scripts/record_snapshot.py --dry-run     # 只印出這筆快照，不寫檔
  python3 scripts/record_snapshot.py --publish     # 寫檔後 commit + push（需要環境變數 AI_OFFICE_GITHUB_TOKEN）
publish_usage.py 每次寫入 usage.json 時也會自動呼叫這裡的 record()，並把 history.json 一起 commit。
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import office_pools as op  # noqa: E402

HISTORY = op.DATA / "history.json"
KEEP_HOURS = 48
MIN_GAP_MIN = 20
DAILY_KEEP_DAYS = 35


def pick(d, keys):
    return {k: d[k] for k in keys if isinstance(d, dict) and k in d} if isinstance(d, dict) else None


def make_snapshot(src, now, prev=None):
    pools, top3 = op.build_pools(src, now)
    u = src.get("usage") or {}
    t = op.team_entry(u) or {}
    ce = op.codex_entry(u)
    o = src.get("openai") or {}
    level_pools = [p for p in pools if op.num(p.get("used")) and not p["stale"]]
    worst = max(level_pools, key=lambda p: p["used"], default=None)
    snap = {
        "t": op.iso(now),
        "pools": {p["id"]: p.get("used") for p in pools},
        "stale": sorted(p["id"] for p in pools if p["stale"]),
        "openai_today": round(op.openai_today(o, now), 4) if o else None,
        "openai_month": round(float(o.get("spend_month_usd") or 0), 4) if o else None,
        "active": [],
        "top": [[x["id"], x["share"]] for x in top3],
        "worst": [worst["id"], worst["used"]] if worst else None,
        # 回放用的精簡原始值（網站用同一套 js/pools.js 重算）
        "team": pick(t, ["used", "reset_at", "updated_at"]) if t else None,
        "shares": {e["agent_id"]: {"share": e["share_pct"], "label": e.get("share_label"), "used": e.get("used")}
                   for e in op.share_entries(u)},
        "codex": pick(ce, ["used", "limit", "reset_at", "updated_at", "stale", "connected", "reported", "slot", "window"]) if ce else None,
        "subs": src.get("subs") if isinstance(src.get("subs"), dict) else None,
        "gemini_api": pick(src.get("gemini"), ["model", "requests_today", "daily_cap", "day_reset_at", "last_run_at", "last_status"]),
        "openai": pick(o, ["model", "requests_today", "spend_today_usd", "spend_month_usd", "monthly_cap_usd", "month_reset_at", "last_run_at", "last_status"]) if o else None,
    }
    snap["active"] = op.active_agents(src, now, prev)
    return snap


def load_history(path):
    try:
        h = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(h, dict) and isinstance(h.get("snapshots"), list):
            h.setdefault("openai_daily", {})
            return h
    except (OSError, ValueError):
        pass
    return {"schema_version": 1, "snapshots": [], "openai_daily": {}}


def dump(h):
    """一筆快照一行，diff 好讀。"""
    head = {k: v for k, v in h.items() if k not in ("snapshots", "openai_daily")}
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},")
    lines.append(f'  "openai_daily": {json.dumps(h["openai_daily"], ensure_ascii=False, sort_keys=True)},')
    lines.append('  "snapshots": [')
    snaps = [json.dumps(s, ensure_ascii=False, separators=(",", ":")) for s in h["snapshots"]]
    lines.append(",\n".join("    " + s for s in snaps))
    lines.append("  ]")
    lines.append("}")
    return "\n".join(lines) + "\n"


def record(now=None, history_path=HISTORY, data_dir=op.DATA, min_gap_min=MIN_GAP_MIN, keep_hours=KEEP_HOURS, write=True):
    now = now or op.now_tw()
    src = op.load_sources(data_dir)
    h = load_history(history_path)
    snaps = [s for s in h["snapshots"] if isinstance(s, dict) and op.parse_time(s.get("t"))]
    snaps = [s for s in snaps if op.age_h(s["t"], now) <= keep_hours and op.parse_time(s["t"]) <= now]
    snaps.sort(key=lambda s: op.parse_time(s["t"]))
    replaced = bool(snaps) and op.age_h(snaps[-1]["t"], now) * 60 < min_gap_min
    if replaced:
        snaps.pop()
    snap = make_snapshot(src, now, snaps[-1] if snaps else None)
    snaps.append(snap)
    # 每日 OpenAI 花費（只記錄實際看到的數字）
    o = src.get("openai") or {}
    lr = op.parse_time(o.get("last_run_at"))
    if lr and op.num(o.get("spend_today_usd")):
        day = lr.astimezone(op.TZ).date().isoformat()
        h["openai_daily"][day] = round(max(float(o["spend_today_usd"]), float(h["openai_daily"].get(day, 0))), 6)
    cutoff = (now.astimezone(op.TZ).date().toordinal() - DAILY_KEEP_DAYS)
    h["openai_daily"] = {d: v for d, v in h["openai_daily"].items()
                         if len(d) == 10 and op.dt.date.fromisoformat(d).toordinal() > cutoff}
    h["schema_version"] = 1
    h["updated_at"] = snap["t"]
    h["keep_hours"] = keep_hours
    h["note"] = "AI 辦公室額度快照（scripts/record_snapshot.py 產生；只含百分比、花費統計與時間，不含提示、輸出或金鑰）"
    h["snapshots"] = snaps
    if write:
        Path(history_path).write_text(dump(h), encoding="utf-8")
    return snap, h, replaced


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--history", default=str(HISTORY))
    ap.add_argument("--data-dir", default=str(op.DATA))
    ap.add_argument("--min-gap-min", type=float, default=MIN_GAP_MIN)
    ap.add_argument("--keep-hours", type=float, default=KEEP_HOURS)
    ap.add_argument("--now", help="測試用：指定現在時間（ISO 8601，含時區）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--publish", action="store_true", help="寫檔後 commit + push data/history.json")
    a = ap.parse_args(argv)
    now = op.parse_time(a.now) if a.now else None
    if a.now and not now:
        print(f"失敗：--now 不是含時區的 ISO 時間：{a.now!r}", file=sys.stderr)
        return 1
    if a.publish:
        import publish_usage as pu
        if not os.environ.get("AI_OFFICE_GITHUB_TOKEN"):
            pu.die("沒有設定 AI_OFFICE_GITHUB_TOKEN")
        pu.git("pull", "--rebase", "--quiet", "origin", "main")
    snap, h, replaced = record(now, a.history, a.data_dir, a.min_gap_min, a.keep_hours, write=not a.dry_run)
    pools = " ".join(f"{k}={v}" for k, v in snap["pools"].items())
    msg = f"{'覆蓋' if replaced else '新增'}快照 {snap['t']}：{pools}；活躍 {','.join(snap['active']) or '無'}；共 {len(h['snapshots'])} 筆"
    if a.dry_run:
        print(json.dumps(snap, ensure_ascii=False, indent=2))
        print(msg + "（dry-run，未寫檔）", file=sys.stderr)
        return 0
    if not a.publish:
        print(msg)
        return 0
    import publish_usage as pu
    pu.git("add", "data/history.json")
    if pu.git("diff", "--cached", "--quiet", check=False).returncode == 0:
        print(msg + "；內容沒變，未 commit")
        return 0
    pu.git("commit", "--quiet", "-m", f"Record office snapshot {snap['t']}")
    pu.git("push", "--quiet", "origin", "HEAD:main")
    print(msg + f"；已推送 {pu.git('rev-parse', '--short', 'HEAD').stdout.strip()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
