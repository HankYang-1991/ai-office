/* 內建示範額度（usage.json 讀不到時的備援，例如直接用 file:// 開啟）。自動由 data/usage.json 產生。 */
window.OFFICE_DEMO_USAGE = {
 "schema_version": 1,
 "is_demo": true,
 "note": "示範資料：以下數字皆為虛構，尚未接上任何真實的額度 API。",
 "generated_at": "2026-10-29T18:30:00+08:00",
 "entries": [
  {
   "agent_id": "da-zhuren",
   "provider": "claude-code",
   "window": "5h",
   "used": 62,
   "limit": 100,
   "unit": "%",
   "reset_at": "2026-10-29T21:40:00+08:00",
   "updated_at": "2026-10-29T18:30:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "da-zhuren",
   "provider": "claude-code",
   "window": "weekly",
   "used": 38,
   "limit": 100,
   "unit": "%",
   "reset_at": "2026-11-03T17:00:00+08:00",
   "updated_at": "2026-10-29T18:30:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "xiao-zhuren",
   "provider": "claude-code",
   "window": "5h",
   "used": 24,
   "limit": 100,
   "unit": "%",
   "reset_at": "2026-10-29T23:10:00+08:00",
   "updated_at": "2026-10-29T18:28:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "codex-xiao-zhaowang",
   "provider": "codex",
   "window": "5h",
   "used": 71,
   "limit": 100,
   "unit": "%",
   "reset_at": "2026-10-29T20:15:00+08:00",
   "updated_at": "2026-10-29T18:25:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "codex-xiao-zhaowang",
   "provider": "codex",
   "window": "weekly",
   "used": 45,
   "limit": 100,
   "unit": "%",
   "reset_at": "2026-11-04T14:44:00+08:00",
   "updated_at": "2026-10-29T18:25:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "da-zhaowang",
   "provider": "image-gen",
   "window": "daily",
   "used": 32,
   "limit": 50,
   "unit": "張",
   "reset_at": "2026-10-30T00:00:00+08:00",
   "updated_at": "2026-10-29T18:20:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "zhaowang-xiaobao",
   "provider": "image-gen",
   "window": "daily",
   "used": 12,
   "limit": 50,
   "unit": "張",
   "reset_at": "2026-10-30T00:00:00+08:00",
   "updated_at": "2026-10-29T18:20:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "jiantou-xiao-zhaowang",
   "provider": "music-gen",
   "window": "monthly",
   "used": 140,
   "limit": 500,
   "unit": "credits",
   "reset_at": "2026-11-01T00:00:00+08:00",
   "updated_at": "2026-10-29T17:55:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "grok-bot",
   "provider": "grok",
   "window": "monthly",
   "used": 8.4,
   "limit": 30,
   "unit": "USD",
   "reset_at": "2026-11-01T08:00:00+08:00",
   "updated_at": "2026-10-29T18:30:00+08:00",
   "updated_by": "demo-seed"
  },
  {
   "agent_id": "au-penguin",
   "provider": "grok",
   "window": "5h",
   "used": 120000,
   "limit": 400000,
   "unit": "tok",
   "reset_at": "2026-10-29T22:00:00+08:00",
   "updated_at": "2026-10-29T18:31:00+08:00",
   "updated_by": "demo-seed"
  }
 ]
};
