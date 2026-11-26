/* v2 額度池口徑統一：把 usage / subscriptions / gemini / openai 四份 JSON 換成同一種「已用 %」
 * 前端（橫幅、卡片、機房燈號、時間軸回放）全部讀這裡的結果；scripts/office_pools.py 是同一套規則的 Python 版。
 * 色階：綠 < 70%、黃 70–85%、紅 > 85%。橫幅：任何池 > 85% 紅、75–85% 黃、其餘綠。
 */
(function (root) {
  const C = root.OFFICE_CONFIG || {};
  const A = Object.assign({ green: 70, amber: 85, bannerAmber: 75, bannerRed: 85, critical: 90, charging: 99, headroom: 70, staleHours: 6 }, C.alerts || {});
  const SUBS_STALE_H = C.subscriptionsStaleHours || 14;   // 訂閱用量一天只更新 2 次（12:00、21:00）
  const tz = C.timeZone || 'Asia/Taipei';
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = p => Math.max(0, Math.min(100, p));
  const ms = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };
  const ageH = (iso, now) => { const t = ms(iso); return Number.isFinite(t) ? (now - t) / 3600e3 : Infinity; };
  const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  const r1 = n => Math.round(n * 10) / 10;

  function tier(p) { if (!num(p)) return 'na'; return p > A.amber ? 'red' : p >= A.green ? 'amber' : 'green'; }
  const COLORS = { green: '#4cd964', amber: '#f5b723', red: '#ff5f57', na: '#5b6380', stale: '#ff9d3b' };
  const color = p => COLORS[tier(p)];

  function teamEntry(u) { return (u && u.entries || []).find(e => e.agent_id === 'team'); }
  function shareEntries(u) {
    return (u && u.entries || []).filter(e => e.agent_id !== 'team' && e.provider === 'grok-bot' && e.connected !== false && num(e.share_pct));
  }
  function codexEntry(u) {
    const own = (u && u.entries || []).filter(e => e.scope === 'own' && e.provider === 'openai-codex');
    return own.find(e => e.slot === 'primary' || e.window === 'primary') || own[0] || null;
  }

  /** bundle = { usage, subs, gemini, openai }；now = 毫秒（回放時為快照時間） */
  function build(bundle, now) {
    now = num(now) ? now : Date.now();
    const b = bundle || {}, pools = [];
    const add = p => { p.tier = p.stale ? 'stale' : tier(p.used); pools.push(p); return p; };
    const u = b.usage;
    // 1) Grok Bot 團隊每週共用池
    const t = teamEntry(u);
    let top3 = [];
    if (t && u && !u.is_demo && num(t.used)) {
      const upd = t.updated_at || u.generated_at;
      const shares = shareEntries(u).sort((x, y) => y.share_pct - x.share_pct);
      top3 = shares.slice(0, 3).map(e => ({ id: e.agent_id, share: e.share_pct, label: e.share_label, used: e.used }));
      add({ id: 'team', name: 'Grok Bot 團隊每週', short: '團隊', used: clamp(t.used), raw: `剩 ${r1(100 - clamp(t.used))}%`,
        reset: t.reset_at, updated: upd, stale: ageH(upd, now) > A.staleHours, agents: shares.map(e => e.agent_id), top3, src: 'usage.json' });
    }
    // 2) Codex 獨立額度（小沼王自己回報）
    const ce = codexEntry(u);
    if (ce && root.CodexState) {
      const st = root.CodexState.state(ce, now);
      if (st !== 'unavailable') {
        const fresh = st === 'fresh';
        add({ id: 'codex', name: 'Codex（小沼王）', short: 'Codex', used: fresh ? clamp(ce.used) : null,
          raw: fresh ? `剩 ${r1(100 - clamp(ce.used))}%` : '資料過期', reset: ce.reset_at, updated: ce.updated_at,
          stale: !fresh, agents: ['codex-xiao-zhaowang'], src: 'usage.json' });
      }
    }
    // 3) Claude / Gemini 訂閱
    const s = b.subs;
    if (s && s.updated_at) {
      const stale = ageH(s.updated_at, now) > SUBS_STALE_H;
      const pct = (v, reset) => !num(v) ? null : (reset && ms(reset) <= now ? 0 : clamp(v));
      if (s.claude && num(s.claude.weekly_pct)) {
        const p = pct(s.claude.weekly_pct, s.claude.weekly_reset);
        add({ id: 'claude', name: `Claude ${s.claude.plan || ''} 本週`.replace(/\s+/g, ' '), short: 'Claude', used: p, raw: `剩 ${r1(100 - p)}%`,
          reset: s.claude.weekly_reset, updated: s.updated_at, stale, agents: [], src: 'subscriptions.json' });
      }
      if (s.claude && num(s.claude.session_pct)) {
        add({ id: 'claude_5h', minor: true, name: 'Claude 五小時', short: 'Claude 5h', used: clamp(s.claude.session_pct),
          raw: `剩 ${r1(100 - clamp(s.claude.session_pct))}%`, updated: s.updated_at, stale, agents: [], src: 'subscriptions.json' });
      }
      if (s.gemini && num(s.gemini.weekly_pct)) {
        const p = pct(s.gemini.weekly_pct, s.gemini.weekly_reset);
        add({ id: 'gemini_sub', name: `Gemini ${s.gemini.plan ? '（' + s.gemini.plan + '）' : ''}每週`, short: 'AI Pro', used: p, raw: `剩 ${r1(100 - p)}%`,
          reset: s.gemini.weekly_reset, updated: s.updated_at, stale, agents: [], src: 'subscriptions.json' });
      }
      if (s.gemini && num(s.gemini.current_pct)) {
        const p = pct(s.gemini.current_pct, s.gemini.current_reset);
        add({ id: 'gemini_cur', minor: true, name: 'Gemini 目前時段', short: 'AI Pro 目前', used: p, raw: `剩 ${r1(100 - p)}%`,
          reset: s.gemini.current_reset, updated: s.updated_at, stale, agents: [], src: 'subscriptions.json' });
      }
    }
    // 4) Gemini 計算員 API 免費額度（過了重置時間 = 今天還沒用）
    const g = b.gemini;
    if (g && num(g.daily_cap)) {
      const reset = ms(g.day_reset_at) <= now;
      const n = reset ? 0 : g.requests_today;
      const p = clamp(n / g.daily_cap * 100);
      add({ id: 'gemini_api', name: 'Gemini API 今日', short: 'Gem API', used: p, raw: `${n}/${g.daily_cap} 次`,
        reset: reset ? null : g.day_reset_at, updated: g.last_run_at, stale: false, limited: g.last_status === 'rate_limited',
        note: reset && g.requests_today ? `上次（${dayKey(ms(g.last_run_at))}）用了 ${g.requests_today} 次，已重置` : '',
        agents: ['gemini'], src: 'gemini.json' });
    }
    // 5) 量化分析師 OpenAI API（每月硬上限）
    const o = b.openai;
    if (o && num(o.monthly_cap_usd)) {
      const monthReset = ms(o.month_reset_at) <= now;
      const month = monthReset ? 0 : o.spend_month_usd;
      const today = (!monthReset && Number.isFinite(ms(o.last_run_at)) && dayKey(ms(o.last_run_at)) === dayKey(now)) ? o.spend_today_usd : 0;
      const p = clamp(month / o.monthly_cap_usd * 100);
      add({ id: 'openai', name: 'OpenAI API 本月', short: 'OpenAI', used: p, raw: `$${month.toFixed(2)} / $${o.monthly_cap_usd}`,
        reset: o.month_reset_at, updated: o.last_run_at, stale: false, today, month, cap: o.monthly_cap_usd,
        limited: o.last_status === 'rate_limited' || o.last_status === 'insufficient_quota',
        agents: ['gpt'], src: 'openai.json' });
    }
    for (const p of pools) p.charging = !!(p.limited || (num(p.used) && p.used >= A.charging));
    // 橫幅等級：只看有數字且不過期的池
    const live = pools.filter(p => num(p.used) && !p.stale);
    const worst = live.slice().sort((x, y) => y.used - x.used)[0] || null;
    const level = !worst ? 'green' : worst.used > A.bannerRed ? 'red' : worst.used >= A.bannerAmber ? 'amber' : 'green';
    const headroom = live.filter(p => !p.minor && 100 - p.used > A.headroom && ['gemini_api', 'claude', 'gemini_sub', 'codex'].includes(p.id));
    return { pools, worst, level, staleList: pools.filter(p => p.stale), headroom, top3, now };
  }

  root.OfficePools = { build, tier, color, COLORS, A, ageH, dayKey };
})(typeof window === 'undefined' ? globalThis : window);
