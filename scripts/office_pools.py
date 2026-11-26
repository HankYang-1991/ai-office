#!/usr/bin/env python3
"""AI 辦公室 v2 額度池口徑（Python 版，規則與 js/pools.js 相同）。

把 data/usage.json、subscriptions.json、gemini.json、openai.json 換成同一種「已用 %」的池清單，
給 scripts/record_snapshot.py 與 scripts/check_alerts.py 共用。只讀檔，不呼叫任何 API、不讀金鑰。
"""
import datetime as dt
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
TZ = dt.timezone(dt.timedelta(hours=8))  # Asia/Taipei
STALE_HOURS = 6          # usage.json（每 2 小時同步）超過 6 小時算過期
SUBS_STALE_HOURS = 14    # 訂閱用量一天只更新 2 次（12:00、21:00），沿用網站的 14 小時
CODEX_STALE_HOURS = 24   # 與 js/codex-state.js 相同
ACTIVE_HOURS = 6         # 「近期活躍」視窗
CHARGING = 99
SOURCES = {"usage": "usage.json", "subs": "subscriptions.json", "gemini": "gemini.json",
           "openai": "openai.json", "chat": "chat.json", "history": "history.json"}


def now_tw():
    return dt.datetime.now(TZ).replace(microsecond=0)


def parse_time(v):
    if not isinstance(v, str) or not v:
        return None
    try:
        t = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def iso(t):
    return t.astimezone(TZ).replace(microsecond=0).isoformat() if t else None


def age_h(v, now):
    t = parse_time(v)
    return (now - t).total_seconds() / 3600 if t else float("inf")


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def clamp(p):
    return max(0.0, min(100.0, float(p)))


def r1(x):
    v = round(float(x) + 1e-9, 1)
    return int(v) if v == int(v) else v


def tier(p):
    """卡片色階：綠 < 70、黃 70–85、紅 > 85。"""
    if not num(p):
        return "na"
    return "red" if p > 85 else "amber" if p >= 70 else "green"


def load_sources(data_dir=DATA):
    out = {}
    for k, name in SOURCES.items():
        f = Path(data_dir) / name
        try:
            out[k] = json.loads(f.read_text(encoding="utf-8")) if f.exists() else None
        except (OSError, ValueError):
            out[k] = None
    return out


def codex_state(e, now):
    if (e.get("connected") is False or e.get("reported") is False or e.get("limit") != 100
            or not num(e.get("used")) or not 0 <= e["used"] <= 100):
        return "unavailable"
    upd, reset = parse_time(e.get("updated_at")), parse_time(e.get("reset_at"))
    if (e.get("stale") or e.get("updated_at_unknown") or upd is None or upd > now + dt.timedelta(minutes=1)
            or now - upd > dt.timedelta(hours=CODEX_STALE_HOURS) or (reset is not None and reset <= now)):
        return "stale"
    return "fresh"


def team_entry(u):
    return next((e for e in (u or {}).get("entries", []) if e.get("agent_id") == "team"), None)


def share_entries(u):
    return [e for e in (u or {}).get("entries", [])
            if e.get("agent_id") != "team" and e.get("provider") == "grok-bot"
            and e.get("connected") is not False and num(e.get("share_pct"))]


def codex_entry(u):
    own = [e for e in (u or {}).get("entries", []) if e.get("scope") == "own" and e.get("provider") == "openai-codex"]
    return next((e for e in own if e.get("slot") == "primary" or e.get("window") == "primary"), own[0] if own else None)


def openai_today(o, now):
    """openai.json 的 spend_today_usd 只在 last_run_at 是今天（台北）時才算今天。"""
    if not o:
        return 0.0
    lr, mr = parse_time(o.get("last_run_at")), parse_time(o.get("month_reset_at"))
    if mr and mr <= now:
        return 0.0
    if lr and lr.astimezone(TZ).date() == now.astimezone(TZ).date() and num(o.get("spend_today_usd")):
        return float(o["spend_today_usd"])
    return 0.0


def build_pools(src, now):
    pools = []

    def add(**p):
        p.setdefault("stale", False)
        p.setdefault("minor", False)
        p["tier"] = "stale" if p["stale"] else tier(p.get("used"))
        pools.append(p)

    u = src.get("usage")
    t = team_entry(u)
    top3 = []
    if t and u and u.get("is_demo") is False and num(t.get("used")):
        upd = t.get("updated_at") or u.get("generated_at")
        shares = sorted(share_entries(u), key=lambda e: -e["share_pct"])
        top3 = [{"id": e["agent_id"], "share": e["share_pct"], "label": e.get("share_label"), "used": e.get("used")} for e in shares[:3]]
        add(id="team", name="Grok Bot 團隊每週", used=clamp(t["used"]), raw=f"剩 {r1(100 - clamp(t['used']))}%",
            reset=t.get("reset_at"), updated=upd, stale=age_h(upd, now) > STALE_HOURS,
            agents=[e["agent_id"] for e in shares], top3=top3)
    ce = codex_entry(u)
    if ce:
        st = codex_state(ce, now)
        if st != "unavailable":
            fresh = st == "fresh"
            add(id="codex", name="Codex（小沼王）", used=clamp(ce["used"]) if fresh else None,
                raw=f"剩 {r1(100 - clamp(ce['used']))}%" if fresh else "資料過期", reset=ce.get("reset_at"),
                updated=ce.get("updated_at"), stale=not fresh, agents=["codex-xiao-zhaowang"])
    s = src.get("subs")
    if isinstance(s, dict) and parse_time(s.get("updated_at")):
        stale = age_h(s["updated_at"], now) > SUBS_STALE_HOURS

        def pct(v, reset):
            if not num(v):
                return None
            rt = parse_time(reset)
            return 0.0 if rt and rt <= now else clamp(v)
        c, g = s.get("claude") or {}, s.get("gemini") or {}
        if num(c.get("weekly_pct")):
            p = pct(c["weekly_pct"], c.get("weekly_reset"))
            add(id="claude", name=f"Claude {c.get('plan', '')} 本週".replace("  ", " "), used=p, raw=f"剩 {r1(100 - p)}%",
                reset=c.get("weekly_reset"), updated=s["updated_at"], stale=stale, agents=[])
        if num(c.get("session_pct")):
            add(id="claude_5h", minor=True, name="Claude 五小時", used=clamp(c["session_pct"]),
                raw=f"剩 {r1(100 - clamp(c['session_pct']))}%", updated=s["updated_at"], stale=stale, agents=[])
        if num(g.get("weekly_pct")):
            p = pct(g["weekly_pct"], g.get("weekly_reset"))
            add(id="gemini_sub", name=f"Gemini（{g.get('plan', 'AI Pro')}）每週", used=p, raw=f"剩 {r1(100 - p)}%",
                reset=g.get("weekly_reset"), updated=s["updated_at"], stale=stale, agents=[])
        if num(g.get("current_pct")):
            p = pct(g["current_pct"], g.get("current_reset"))
            rt = parse_time(g.get("current_reset"))
            add(id="gemini_cur", minor=True, name="Gemini 目前時段", used=p, raw=f"剩 {r1(100 - p)}%",
                reset=None if (rt and rt <= now) else g.get("current_reset"), updated=s["updated_at"], stale=stale, agents=[])
    gm = src.get("gemini")
    if isinstance(gm, dict) and num(gm.get("daily_cap")) and gm["daily_cap"] > 0:
        rt = parse_time(gm.get("day_reset_at"))
        n = 0 if (rt and rt <= now) else int(gm.get("requests_today") or 0)
        add(id="gemini_api", name="Gemini API 今日", used=clamp(n / gm["daily_cap"] * 100), raw=f"{n}/{gm['daily_cap']} 次",
            reset=None if (rt and rt <= now) else gm.get("day_reset_at"), updated=gm.get("last_run_at"),
            limited=gm.get("last_status") == "rate_limited", agents=["gemini"])
    o = src.get("openai")
    if isinstance(o, dict) and num(o.get("monthly_cap_usd")) and o["monthly_cap_usd"] > 0:
        mr = parse_time(o.get("month_reset_at"))
        month = 0.0 if (mr and mr <= now) else float(o.get("spend_month_usd") or 0)
        add(id="openai", name="OpenAI API 本月", used=clamp(month / o["monthly_cap_usd"] * 100),
            raw=f"${month:.2f} / ${o['monthly_cap_usd']:g}", reset=o.get("month_reset_at"), updated=o.get("last_run_at"),
            today=round(openai_today(o, now), 6), month=round(month, 6), cap=o["monthly_cap_usd"],
            limited=o.get("last_status") in ("rate_limited", "insufficient_quota"), agents=["gpt"])
    for p in pools:
        p["charging"] = bool(p.get("limited") or (num(p.get("used")) and p["used"] >= CHARGING))
        if num(p.get("used")):
            p["used"] = r1(p["used"]) if p["id"] != "openai" else round(p["used"], 2)
    return pools, top3


def chat_activity(chat, now, hours=ACTIVE_HOURS):
    """近 N 小時在群聊裡發過言的 agent id。"""
    out = set()
    for r in (chat or {}).get("rounds", []) or []:
        for m in r.get("messages", []) or []:
            f = (m or {}).get("from")
            if f and f not in ("user", "system") and age_h(m.get("at") or r.get("started_at"), now) <= hours:
                out.add(f)
    return out


def active_agents(src, now, prev=None):
    """真實訊號推得的「近期活躍」名單（不猜測）：
    - 量化分析師 / Gemini 計算員：last_run_at 在 6 小時內
    - codex-小沼王：Codex 額度 6 小時內有回報且未過期
    - 其他團隊成員：和上一筆快照（8 小時內、同一週）相比團隊額度份額有增加
    - 群聊：6 小時內有發言
    """
    act = set()
    o, g, u = src.get("openai") or {}, src.get("gemini") or {}, src.get("usage")
    if age_h(o.get("last_run_at"), now) <= ACTIVE_HOURS:
        act.add("gpt")
    if age_h(g.get("last_run_at"), now) <= ACTIVE_HOURS:
        act.add("gemini")
    ce = codex_entry(u)
    if ce and codex_state(ce, now) == "fresh" and age_h(ce.get("updated_at"), now) <= ACTIVE_HOURS:
        act.add("codex-xiao-zhaowang")
    if prev and age_h(prev.get("t"), now) <= 8:
        t = team_entry(u) or {}
        same_week = (prev.get("team") or {}).get("reset_at") == t.get("reset_at")
        if same_week:
            before = {k: (v or {}).get("used", 0) for k, v in (prev.get("shares") or {}).items()}
            for e in share_entries(u):
                if num(e.get("used")) and e["used"] - before.get(e["agent_id"], 0) > 0.05:
                    act.add(e["agent_id"])
    act |= chat_activity(src.get("chat"), now)
    return sorted(act)
