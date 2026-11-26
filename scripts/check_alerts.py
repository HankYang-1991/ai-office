#!/usr/bin/env python3
"""AI 辦公室三層額度預警 + 量化分析師單日暴衝防呆。輸出一份 JSON 報告（stdout）。

讀 data/usage.json、subscriptions.json、gemini.json、openai.json、history.json；不呼叫 API、不碰金鑰、不寫檔。
1) grok-bot 團隊每週共用池：< 75% ok；75–84.9% yellow（只在儀表板顯示）；85–89.9% orange（推播提醒）；
   ≥ 90% red（提醒 + 建議改派到 Gemini / Claude 等還有 > 70% 餘裕的池），附前 3 大用量
2) 量化分析師 OpenAI API：今日花費 > $5，或 ≥ 7 日日均的 3 倍 → 暴衝警示；本月 ≥ $80（上限 $95）→ 月額度警示
3) 其他任何池 ≥ 85%，或資料過期（usage.json > 6 小時；訂閱 > 14 小時）

用法：
  python3 scripts/check_alerts.py                  # 印出 JSON 報告，exit 0
  python3 scripts/check_alerts.py --exit-code      # 需要推播（notify=true）時 exit 2，方便排程判斷
  python3 scripts/check_alerts.py --now 2026-11-26T18:00:00+08:00   # 測試用
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import office_pools as op  # noqa: E402

TEAM_TIERS = ((90, "red"), (85, "orange"), (75, "yellow"))
SPIKE_ABS_USD = 5.0
SPIKE_MULT = 3.0
MONTH_WARN_USD = 80.0
OTHER_WARN_PCT = 85.0
HEADROOM_PCT = 70.0
ROUTE_NAMES = {"gemini_api": "Gemini 計算員（Gemini API 免費額度）", "claude": "Claude", "gemini_sub": "Gemini（Google AI Pro）",
               "codex": "codex-小沼王（Codex 獨立額度）"}
SOURCE_OF = {"team": "usage.json", "codex": "usage.json#codex", "claude": "subscriptions.json", "claude_5h": "subscriptions.json",
             "gemini_sub": "subscriptions.json", "gemini_cur": "subscriptions.json"}
SOURCE_NAME = {"usage.json": "團隊額度（usage.json）", "usage.json#codex": "Codex 額度回報", "subscriptions.json": "Claude / Gemini 訂閱（subscriptions.json）"}


def agent_names():
    try:
        import publish_usage as pu
        return {a["id"]: a["name"] for a in pu.load_agents()}
    except SystemExit:
        return {}


def team_status(pools, top3, names):
    t = next((p for p in pools if p["id"] == "team"), None)
    if not t:
        return {"status": "unknown", "notify": False, "message": "沒有團隊額度資料"}
    used = t["used"]
    st = next((name for lim, name in TEAM_TIERS if used >= lim), "ok")
    headroom = [p for p in pools if p["id"] in ROUTE_NAMES and op.num(p.get("used")) and not p["stale"]
                and 100 - p["used"] > HEADROOM_PCT]
    out = {
        "status": st, "used_pct": used, "remaining_pct": op.r1(100 - used), "reset_at": t.get("reset"),
        "updated_at": t.get("updated"), "stale": t["stale"],
        "top3": [{"agent_id": x["id"], "name": names.get(x["id"], x["id"]), "share_pct": x["share"],
                  "weekly_pct": x.get("used")} for x in top3],
        "notify": st in ("orange", "red"),
    }
    if st == "red":
        out["routing"] = [{"pool": p["id"], "to": ROUTE_NAMES[p["id"]], "remaining_pct": op.r1(100 - p["used"])}
                          for p in sorted(headroom, key=lambda p: p["used"])]
        out["message"] = (f"團隊每週額度已用 {used}%（剩 {op.r1(100 - used)}%），建議把重複運算改派給 "
                          + ("、".join(r["to"] for r in out["routing"]) or "其他還有餘裕的池"))
    elif st == "orange":
        out["message"] = f"團隊每週額度已用 {used}%，接近上限，請留意前 3 大用量"
    elif st == "yellow":
        out["message"] = f"團隊每週額度已用 {used}%（儀表板黃燈）"
    else:
        out["message"] = f"團隊每週額度已用 {used}%，正常"
    return out


def openai_guard(src, hist, now):
    o = src.get("openai")
    if not isinstance(o, dict):
        return {"status": "unknown", "notify": False, "alerts": [], "message": "沒有 openai.json"}
    today = op.openai_today(o, now)
    mr = op.parse_time(o.get("month_reset_at"))
    month = 0.0 if (mr and mr <= now) else float(o.get("spend_month_usd") or 0)
    cap = float(o.get("monthly_cap_usd") or 95)
    today_key = now.astimezone(op.TZ).date()
    daily = (hist or {}).get("openai_daily") or {}
    prev = []
    for d, v in daily.items():
        try:
            dd = op.dt.date.fromisoformat(d)
        except ValueError:
            continue
        if 1 <= (today_key - dd).days <= 7 and op.num(v):
            prev.append(float(v))
    # 7 日平均只用 history.json 真的記錄到的每日花費；不足 3 天時 3 倍規則先不啟用（只看 $5 絕對門檻），避免拿推估值誤報
    mult_active = len(prev) >= 3
    if mult_active:
        avg, basis = sum(prev) / len(prev), f"history.json 前 {len(prev)} 天實際花費"
    else:
        days_before = today_key.day - 1
        avg = (max(0.0, month - today) / days_before) if days_before > 0 else None
        basis = (f"參考值：本月 1–{days_before} 日平均（history 只累積 {len(prev)} 天，3 倍規則累積滿 3 天後啟用）"
                 if days_before > 0 else "月初，無平均")
    alerts = []
    if today > SPIKE_ABS_USD:
        alerts.append({"type": "daily_spike_abs", "message": f"今日花費 ${today:.2f} 超過 ${SPIKE_ABS_USD:g}"})
    if mult_active and avg and avg > 0 and today >= SPIKE_MULT * avg and today > 0.5:
        alerts.append({"type": "daily_spike_mult", "message": f"今日花費 ${today:.2f} ≥ 日均 ${avg:.2f} 的 {SPIKE_MULT:g} 倍"})
    if month >= MONTH_WARN_USD:
        alerts.append({"type": "monthly", "message": f"本月花費 ${month:.2f} 已達 ${MONTH_WARN_USD:g}（上限 ${cap:g}）"})
    if o.get("last_status") in ("rate_limited", "insufficient_quota"):
        alerts.append({"type": "limited", "message": f"上次呼叫狀態：{o.get('last_status')}"})
    return {
        "status": "alert" if alerts else "ok", "notify": bool(alerts),
        "today_usd": round(today, 4), "avg7_usd": round(avg, 4) if avg is not None else None, "avg_basis": basis,
        "spike_mult_rule_active": mult_active,
        "month_usd": round(month, 4), "cap_usd": cap, "month_pct": round(month / cap * 100, 2) if cap else None,
        "last_run_at": o.get("last_run_at"), "alerts": alerts,
        "message": "；".join(a["message"] for a in alerts) or f"今日 ${today:.2f}、本月 ${month:.2f} / ${cap:g}，正常",
    }


def check(now=None, data_dir=op.DATA):
    now = now or op.now_tw()
    src = op.load_sources(data_dir)
    names = agent_names()
    pools, top3 = op.build_pools(src, now)
    team = team_status(pools, top3, names)
    oai = openai_guard(src, src.get("history"), now)
    others = [{"pool": p["id"], "name": p["name"], "used_pct": p["used"], "raw": p.get("raw")}
              for p in pools if p["id"] != "team" and op.num(p.get("used")) and not p["stale"] and p["used"] >= OTHER_WARN_PCT]
    stale, seen = [], set()
    for p in pools:
        if not p["stale"]:
            continue
        srcf = SOURCE_OF.get(p["id"], p["id"])
        if srcf in seen:
            continue
        seen.add(srcf)
        stale.append({"source": srcf, "pool": p["id"], "name": SOURCE_NAME.get(srcf, p["name"]), "updated_at": p.get("updated"),
                      "age_hours": round(op.age_h(p.get("updated"), now), 1) if op.parse_time(p.get("updated")) else None})
    hist = src.get("history") or {}
    snaps = hist.get("snapshots") or []
    if snaps and op.age_h(snaps[-1].get("t"), now) > op.STALE_HOURS:
        stale.append({"source": "history.json", "pool": "history", "name": "history.json 快照", "updated_at": snaps[-1].get("t"),
                      "age_hours": round(op.age_h(snaps[-1].get("t"), now), 1)})
    notify = team["notify"] or oai["notify"] or bool(others) or bool(stale)
    order = {"ok": 0, "unknown": 0, "yellow": 1, "orange": 2, "red": 3}
    overall = team["status"] if team["status"] in order else "ok"
    if (others or oai["notify"]) and order[overall] < 2:
        overall = "orange"
    lines = []
    if team["status"] != "ok":
        lines.append(team["message"])
    if oai["notify"]:
        lines.append("量化分析師：" + oai["message"])
    lines += [f"{o['name']} 已用 {o['used_pct']}%（{o['raw']}）" for o in others]
    lines += [f"{s['name']} 資料過期（{s['age_hours']} 小時沒更新）" for s in stale]
    return {
        "generated_at": op.iso(now), "overall": overall, "notify": notify,
        "summary": "；".join(lines) if lines else "全部額度池正常",
        "team": team, "openai_guard": oai, "other_alerts": others, "stale": stale,
        "pools": [{k: p.get(k) for k in ("id", "name", "used", "tier", "raw", "reset", "updated", "stale", "charging")} for p in pools],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=str(op.DATA))
    ap.add_argument("--now", help="測試用：指定現在時間（ISO 8601，含時區）")
    ap.add_argument("--exit-code", action="store_true", help="notify=true 時 exit 2")
    a = ap.parse_args(argv)
    now = op.parse_time(a.now) if a.now else None
    if a.now and not now:
        print(f"失敗：--now 不是含時區的 ISO 時間：{a.now!r}", file=sys.stderr)
        return 1
    rep = check(now, a.data_dir)
    print(json.dumps(rep, ensure_ascii=False, indent=2))
    return 2 if (a.exit_code and rep["notify"]) else 0


if __name__ == "__main__":
    sys.exit(main())
