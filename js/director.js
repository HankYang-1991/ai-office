/* v2 狀態驅動：把 usage / openai / gemini / chat / subscriptions / history 的真實訊號換成像素角色的行為
 * - 近期活躍 → 回座打字＋頭上冒角色圖示；高負載 → 冒汗、全速打字；額度池滿載/限流 → 走去休息區「充電中」
 * - 群聊接力：Grok Bot → 澳洲企鵝 → 被點名的夥伴（走過去停 2 秒交接，對方亮起工作狀態）
 * - 沒有近期活動的夥伴會定期去休息區（撞球桌、書櫃、販賣機、沙發）走走
 * 手動按鈕（召集會議／全員回座／休息一下）優先；時間到後自動回到這裡的狀態。
 */
(function () {
  const C = window.OFFICE_CONFIG, O = window.Office, P = window.OfficePools;
  const A = P.A;
  const ACTIVE_H = 6, HOT_MIN = 10;
  const cfgById = Object.fromEntries(C.agents.map(a => [a.id, a]));
  const rand = (a, b) => a + Math.random() * (b - a);
  const ms = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };
  const ageMin = (iso, now) => { const t = ms(iso); return Number.isFinite(t) ? (now - t) / 60000 : Infinity; };
  const SPOTS = Object.keys(C.breakSpots || {});

  let enabled = true, signals = {}, handoffs = [], lastHandoff = 0, handoffIdx = 0, replaying = false;
  try { enabled = localStorage.getItem('aiOffice.auto') !== 'off'; } catch (e) {}

  // 群聊裡的交接紀錄：每一輪 = Hank → Grok Bot → 澳洲企鵝 → 被點名／有回覆的夥伴
  const nameKeys = C.agents.flatMap(a => [[a.name.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(), a.id], [a.short.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(), a.id]])
    .concat([['gemini', 'gemini'], ['gpt', 'gpt'], ['小沼王', 'codex-xiao-zhaowang'], ['codex', 'codex-xiao-zhaowang']]);
  function mentions(text) {
    const out = new Set();
    for (const m of String(text || '').matchAll(/@([^\s@，,。:：]+)/g)) {
      const k = m[1].replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      const hit = nameKeys.filter(([n]) => n && k.startsWith(n)).sort((x, y) => y[0].length - x[0].length)[0];
      if (hit) out.add(hit[1]);
    }
    return out;
  }
  function parseHandoffs(chat, now) {
    const list = [];
    for (const r of (chat && chat.rounds) || []) {
      const msgs = r.messages || [];
      const t = ms(r.started_at) || ms((msgs[0] || {}).at);
      if (!Number.isFinite(t) || now - t > 24 * 3600e3 || t > now + 60000) continue;
      const targets = new Set();
      msgs.forEach(m => { if (m && m.from === 'user') mentions(m.text).forEach(id => targets.add(id)); if (m && cfgById[m.from]) targets.add(m.from); });
      targets.delete('au-penguin');
      for (const id of targets) list.push({ to: id, title: r.title || '群聊', at: t });
    }
    return list.sort((a, b) => b.at - a.at).slice(0, 12);
  }

  /** 每位夥伴的真實訊號（只根據資料，不亂猜） */
  function computeSignals(bundle, built, history, now) {
    const out = {}, poolById = Object.fromEntries(built.pools.map(p => [p.id, p]));
    const u = bundle.usage, shares = {};
    for (const e of (u && u.entries) || []) if (e.provider === 'grok-bot' && e.agent_id !== 'team' && typeof e.share_pct === 'number') shares[e.agent_id] = e;
    // 近期活躍：回放時用快照記錄的名單；即時則看最新快照（6 小時內）、群聊發言與各自的 API 執行時間
    const snaps = (history && history.snapshots) || [];
    const lastSnap = snaps.filter(s => ms(s.t) <= now).slice(-1)[0];
    const snapActive = new Set(bundle.activeOverride || (lastSnap && ageMin(lastSnap.t, now) <= ACTIVE_H * 60 ? lastSnap.active : []) || []);
    const chatActive = new Set();
    for (const r of (bundle.chat && bundle.chat.rounds) || []) for (const m of r.messages || []) if (m && cfgById[m.from] && ageMin(m.at || r.started_at, now) <= ACTIVE_H * 60) chatActive.add(m.from);
    const deltasKnown = !bundle.activeOverride && snaps.length >= 2;
    for (const a of C.agents) {
      const ps = (a.pools || []).map(id => poolById[id]).filter(Boolean);
      const live = ps.filter(p => typeof p.used === 'number' && !p.stale);
      const poolMax = live.reduce((m, p) => Math.max(m, p.used), 0);
      const sh = shares[a.id];
      const s = { hot: false, active: false, load: false, charging: ps.some(p => p.charging), reasons: [], share: sh ? sh.share_pct : null, poolMax };
      let runAt = null;
      if (a.id === 'gpt' && bundle.openai) runAt = bundle.openai.last_run_at;
      if (a.id === 'gemini' && bundle.gemini) runAt = bundle.gemini.last_run_at;
      if (runAt) {
        const m = ageMin(runAt, now);
        if (m <= HOT_MIN) { s.hot = true; s.reasons.push('剛剛執行 API'); }
        else if (m <= ACTIVE_H * 60) { s.active = true; s.reasons.push(`${Math.round(m / 60) || '<1'} 小時內執行過 API`); }
      }
      if (a.id === 'gpt' && poolById.openai && poolById.openai.today > 0 && !s.active && !s.hot) { s.active = true; s.reasons.push(`今日花費 $${poolById.openai.today.toFixed(2)}`); }
      if (a.id === 'codex-xiao-zhaowang' && poolById.codex && !poolById.codex.stale && ageMin(poolById.codex.updated, now) <= ACTIVE_H * 60) { s.active = true; s.reasons.push('Codex 6 小時內回報額度'); }
      if (snapActive.has(a.id) && !s.active && !s.hot) { s.active = true; s.reasons.push(bundle.activeOverride ? '快照記錄為活躍' : '團隊額度份額近期有增加'); }
      if (chatActive.has(a.id)) { s.active = true; s.reasons.push('群聊 6 小時內有發言'); }
      if (!deltasKnown && !bundle.activeOverride && !s.active && !s.hot && sh && sh.share_pct >= 8) { s.active = true; s.reasons.push(`本週佔團隊用量 ${sh.share_pct}%（前段）`); }
      if ((sh && sh.share_pct > 25) || poolMax > A.critical) { s.load = true; s.reasons.push(sh && sh.share_pct > 25 ? `本週佔團隊 ${sh.share_pct}%，高負載` : `額度池已用 ${Math.round(poolMax)}%`); }
      if (s.charging) s.reasons.push('額度池滿載／限流，休息充電');
      if (!s.reasons.length) s.reasons.push('近期沒有活動紀錄 → 自主巡遊');
      out[a.id] = s;
    }
    return out;
  }

  function brain(a) {
    if (!enabled) return null;
    const s = signals[a.id]; if (!s) return null;
    const cfg = a.cfg;
    if (s.charging) return { state: 'charge', stay: rand(25, 40), note: '充電中' };
    const seatPick = () => (cfg.altSeats && cfg.altSeats.length && Math.random() < 0.35) ? cfg.altSeats[(Math.random() * cfg.altSeats.length) | 0] : cfg.seat;
    if (s.hot) return { state: 'working', stay: rand(25, 40), seat: cfg.seat, note: s.reasons[0] };
    if (s.active) {
      if (Math.random() < 0.82) return { state: 'working', stay: rand(18, 34), seat: seatPick(), note: s.reasons[0] };
      return { state: 'idle', stay: rand(6, 10), spot: SPOTS[(Math.random() * SPOTS.length) | 0] };
    }
    const r = Math.random();
    if (r < 0.42) return { state: 'working', stay: rand(10, 18), seat: seatPick() };
    if (r < 0.9) return { state: 'idle', stay: rand(8, 16), spot: SPOTS[(Math.random() * SPOTS.length) | 0] };
    return { state: 'meeting', stay: rand(8, 14) };
  }
  O.setBrain(brain);

  function applyFx() {
    for (const a of C.agents) {
      const s = signals[a.id] || {};
      O.setFx(a.id, enabled ? { active: !!(s.active || s.hot || s.boost), sweat: !!s.load, turbo: !!(s.load && (s.active || s.hot)), charging: !!s.charging } : {});
    }
  }
  function boost(id, sec) {
    const s = signals[id]; if (!s) return;
    s.boost = true; applyFx();
    setTimeout(() => { if (signals[id]) { signals[id].boost = false; applyFx(); } }, sec * 1000);
  }

  // 交接動畫：每 40 秒輪播一筆近期交接
  function runHandoff(h) {
    const peng = O.byId['au-penguin'], target = O.byId[h.to];
    if (!peng || !target || peng.manual || peng.state === 'charge' || O.isPaused()) return false;
    const deliver = () => O.visit('au-penguin', h.to, { stay: 2.2, onArrive: () => {
      O.say('au-penguin', `交接：${h.title.slice(0, 8)}`, 2200);
      boost(h.to, 45);
      if (!target.manual && target.state !== 'charge') O.setState(h.to, 'working', 40, { seat: target.cfg.seat, note: '剛收到交接任務' });
      setTimeout(() => O.say(h.to, '收到！', 1800), 900);
    } });
    const gb = O.byId['grok-bot'];
    if (h.to !== 'grok-bot' && gb && !gb.manual && gb.state !== 'charge') {
      const ok = O.visit('grok-bot', 'au-penguin', { stay: 1.6, onArrive: () => { O.say('grok-bot', '轉給你 🐧', 1500); setTimeout(deliver, 600); } });
      if (ok) return true;
    }
    return deliver();
  }
  setInterval(() => {
    if (!enabled || document.hidden || !handoffs.length) return;
    if (Date.now() - lastHandoff < 40000) return;
    lastHandoff = Date.now();
    runHandoff(handoffs[handoffIdx++ % handoffs.length]);
  }, 2000);

  /** app.js 每次資料更新（或回放切換快照）都會呼叫 */
  function update(bundle, built, history, now, opts) {
    const prev = signals;
    signals = computeSignals(bundle, built, history, now);
    handoffs = parseHandoffs(bundle.chat, now);
    replaying = !!(opts && opts.replay);
    applyFx();
    if (!enabled) return;
    const first = !Object.keys(prev).length;
    for (const a of C.agents) {
      const p = prev[a.id] || {}, s = signals[a.id];
      if (first || opts && opts.force || p.charging !== s.charging || (p.active || p.hot) !== (s.active || s.hot)) O.replan(a.id);
    }
    if (first && handoffs.length) lastHandoff = Date.now() - 32000;   // 開頁 8 秒後先播一次交接
  }
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem('aiOffice.auto', enabled ? 'on' : 'off'); } catch (e) {}
    applyFx();
    if (enabled) O.replanAll();
  }
  window.OfficeDirector = {
    update, setEnabled, isEnabled: () => enabled, signals: () => signals, handoffs: () => handoffs,
    runHandoff: i => handoffs.length ? runHandoff(handoffs[(i || 0) % handoffs.length]) : false, parseHandoffs, mentions,
  };
})();
