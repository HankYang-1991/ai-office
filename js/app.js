/* UI v2：頁首警戒橫幅、統一口徑額度卡、三組工具列、分部門 Agent 卡、右側分頁（全員群聊｜角色詳情）、一日時間軸回放 */
(function () {
  const C = window.OFFICE_CONFIG, O = window.Office, S = window.OfficeSprites, P = window.OfficePools, D = window.OfficeDirector;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;
  const cfgById = Object.fromEntries(C.agents.map(a => [a.id, a]));
  const ASSETS = C.assets || {};
  const A = P.A;
  const DEPTS = C.departments || [];
  const deptById = Object.fromEntries(DEPTS.map(d => [d.id, d]));
  // 卡片順序：依部門排，5×2 格每一列剛好兩個部門（中樞 3 + 電機 2 / 程式量化 2 + 創作 3）
  const ORDER = DEPTS.flatMap(d => C.agents.filter(a => a.dept === d.id)).concat(C.agents.filter(a => !deptById[a.dept]));

  // ---------- 頭像：有登記的立繪頭像就用，載入失敗自動退回程式繪製的像素頭像 ----------
  function avatarImg(a, scale, cls) {
    const custom = ASSETS.avatars && ASSETS.avatars[a.id];
    const c = cls ? ` class="${cls}${custom ? ' custom' : ''}"` : (custom ? ' class="custom"' : '');
    return custom
      ? `<img${c} src="${esc(custom)}" data-fb="${a.id}" data-fbs="${scale || 4}" alt="" loading="lazy" decoding="async">`
      : `<img${c} src="${S.avatar(a, scale)}" alt="">`;
  }
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.fb && cfgById[img.dataset.fb]) {
      img.src = S.avatar(cfgById[img.dataset.fb], +img.dataset.fbs || 4); img.classList.remove('custom'); delete img.dataset.fb;
    } else if (img.dataset.optional) img.remove();
  }, true);

  // ---------- 時間格式（台北時間） ----------
  const fmtDT = new Intl.DateTimeFormat('zh-TW', { timeZone: C.timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtT = new Intl.DateTimeFormat('zh-TW', { timeZone: C.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : fmtDT.format(d); };
  let NOW = () => Date.now();    // 回放時改成快照時間
  function fmtLeft(iso) {
    const d = new Date(iso) - NOW(); if (!iso || isNaN(d)) return '';
    if (d <= 0) return '已到重置時間';
    const m = Math.round(d / 60000), h = Math.floor(m / 60), day = Math.floor(h / 24);
    return day ? `還有 ${day} 天 ${h % 24} 小時` : h ? `還有 ${h} 小時 ${m % 60} 分` : `還有 ${m} 分`;
  }
  const ageH = iso => P.ageH(iso, NOW());
  function fmtAge(iso) {
    const h = ageH(iso); if (!Number.isFinite(h)) return '時間不明';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分鐘前`;
    if (h < 48) return `${Math.round(h)} 小時前`;
    return `${Math.round(h / 24)} 天前`;
  }
  const fmtNum = n => n == null ? '∞' : Math.abs(n) >= 10000 ? (n / 1000).toFixed(0) + 'k' : (Math.round(n * 10) / 10).toLocaleString('zh-TW');
  const fmtPct = n => typeof n === 'number' && Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) + '%' : '—';
  const fmtUsd = n => (typeof n !== 'number' || !Number.isFinite(n)) ? '—' : n === 0 ? '$0' : Math.abs(n) < 0.01 ? '$' + n.toFixed(4) : '$' + n.toFixed(2);

  // ---------- 資料讀取（全部唯讀 JSON；網站本身不呼叫任何 AI API） ----------
  async function getJSON(url) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function validateUsage(j) {
    const out = { schema_version: j && j.schema_version || 1, is_demo: j ? j.is_demo !== false : true, generated_at: j && j.generated_at, note: j && j.note, entries: [] };
    for (const e of (j && Array.isArray(j.entries) ? j.entries : [])) {
      const ok = e && typeof e.agent_id === 'string' && typeof e.provider === 'string' && typeof e.used === 'number' && (e.limit === null || typeof e.limit === 'number') && 'reset_at' in e && typeof e.updated_at === 'string';
      if (ok) out.entries.push(e); else console.warn('[usage] 略過格式不符的資料', e);
    }
    return out;
  }
  const CLAUDE_FIELDS = { plan: 'str', session_pct: 'pct', session_note: 'str', weekly_pct: 'pct', weekly_reset: 'time', claude_code_weekly_pct: 'pct', status: 'str' };
  const GEMINI_FIELDS = { plan: 'str', current_pct: 'pct', current_reset: 'time', weekly_pct: 'pct', weekly_reset: 'time' };
  const validSubPct = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  const validIso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
  const validSubStr = v => typeof v === 'string' && v.length > 0 && v.length <= 40 ? v : null;
  function sanitizeSubPlan(obj, fields) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out = {}; let hasPct = false;
    for (const [k, kind] of Object.entries(fields)) {
      if (!(k in obj) || obj[k] == null) continue;
      const v = kind === 'pct' ? validSubPct(obj[k]) : kind === 'time' ? validIso(obj[k]) : validSubStr(String(obj[k]).trim());
      if (v == null) return null;
      out[k] = v; if (kind === 'pct') hasPct = true;
    }
    return hasPct ? out : null;
  }
  function validateSubs(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const updated_at = validIso(j.updated_at); if (!updated_at) return null;
    const claude = sanitizeSubPlan(j.claude, CLAUDE_FIELDS), gemini = sanitizeSubPlan(j.gemini, GEMINI_FIELDS);
    if (!claude && !gemini) return null;
    return { updated_at, claude, gemini };
  }
  const validInt = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v === Math.floor(v) && v >= lo && v <= hi ? v : null;
  const validMoney = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  const validModel = v => typeof v === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : null;
  function validateGemini(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const model = validModel(j.model), requests_today = validInt(j.requests_today, 0, 100000), daily_cap = validInt(j.daily_cap, 1, 100000);
    const day_reset_at = validIso(j.day_reset_at), last_run_at = validIso(j.last_run_at);
    const last_status = ['ok', 'rate_limited', 'error'].includes(j.last_status) ? j.last_status : null;
    if (!model || requests_today == null || daily_cap == null || !day_reset_at || !last_run_at || !last_status) return null;
    return { model, requests_today, daily_cap, day_reset_at, last_run_at, last_status };
  }
  function validateOpenAI(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const model = validModel(j.model), requests_today = validInt(j.requests_today, 0, 1000000);
    const spend_today_usd = validMoney(j.spend_today_usd, 0, 100000), spend_month_usd = validMoney(j.spend_month_usd, 0, 100000), monthly_cap_usd = validMoney(j.monthly_cap_usd, 0.01, 100000);
    const month_reset_at = validIso(j.month_reset_at), last_run_at = validIso(j.last_run_at);
    const last_status = ['ok', 'rate_limited', 'error', 'insufficient_quota'].includes(j.last_status) ? j.last_status : null;
    if (!model || requests_today == null || spend_today_usd == null || spend_month_usd == null || monthly_cap_usd == null || !month_reset_at || !last_run_at || !last_status) return null;
    return { model, requests_today, spend_today_usd, spend_month_usd, monthly_cap_usd, month_reset_at, last_run_at, last_status };
  }
  function validateHistory(j) {
    if (!j || typeof j !== 'object' || !Array.isArray(j.snapshots)) return null;
    const snaps = j.snapshots.filter(s => s && validIso(s.t)).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    return { updated_at: validIso(j.updated_at), snapshots: snaps };
  }

  const Live = { usage: null, usageSrc: '', usageErr: '', usageLoadedAt: null, subs: null, gemini: null, openai: null, chat: null, chatErr: '', history: null };
  async function loadUsage() {
    try { Live.usage = validateUsage(await getJSON(C.usageUrl)); Live.usageSrc = 'file'; Live.usageErr = ''; }
    catch (e) {
      Live.usageErr = String(e.message || e);
      // 讀取失敗時保留上一次成功的真實資料，只有從沒讀到過才退回內建示範資料
      if (Live.usageSrc !== 'file') { Live.usage = validateUsage(window.OFFICE_DEMO_USAGE); Live.usageSrc = 'builtin'; }
    }
    Live.usageLoadedAt = new Date();
  }
  const keepOld = (key, fn) => async () => { try { const v = fn(await getJSON(C[key + 'Url'])); if (!v) throw new Error('invalid'); Live[key] = v; } catch (e) { /* 保留上次 */ } };
  const loadSubs = async () => { if (!C.subscriptionsUrl) return; try { const v = validateSubs(await getJSON(C.subscriptionsUrl)); if (v) Live.subs = v; } catch (e) {} };
  const loadGemini = keepOld('gemini', validateGemini);
  const loadOpenAI = keepOld('openai', validateOpenAI);
  const loadHistory = keepOld('history', validateHistory);
  async function loadAll() {
    await Promise.all([loadUsage(), loadSubs(), loadGemini(), loadOpenAI(), loadHistory()]);
    refresh();
  }

  // ---------- 目前要顯示的資料：即時，或時間軸回放的快照 ----------
  const Replay = { idx: -1, playing: false, timer: 0 };
  function snapshots() {
    const all = (Live.history && Live.history.snapshots) || [];
    const day = all.filter(s => Date.now() - Date.parse(s.t) <= 24 * 3600e3);
    return day.length ? day : all.slice(-1);
  }
  function snapshotBundle(s) {
    const entries = [];
    if (s.team && typeof s.team.used === 'number') {
      entries.push({ agent_id: 'team', provider: 'grok-bot', window: 'weekly', scope: 'team', used: s.team.used, limit: 100, unit: '%', reset_at: s.team.reset_at, updated_at: s.team.updated_at });
      for (const [id, v] of Object.entries(s.shares || {})) entries.push({ agent_id: id, provider: 'grok-bot', window: 'weekly', used: v.used, share_pct: v.share, share_label: v.label, connected: true, limit: 100, unit: '%', reset_at: s.team.reset_at, updated_at: s.team.updated_at });
    }
    if (s.codex) entries.push(Object.assign({ agent_id: 'codex-xiao-zhaowang', provider: 'openai-codex', scope: 'own', unit: '%' }, s.codex));
    return {
      usage: { is_demo: false, generated_at: s.team && s.team.updated_at, entries }, usageSrc: 'file',
      subs: validateSubs(s.subs), gemini: validateGemini(s.gemini_api), openai: validateOpenAI(s.openai),
      chat: Live.chat, activeOverride: Array.isArray(s.active) ? s.active : [], snapshotAt: s.t,
    };
  }
  function bundle() {
    const snaps = snapshots();
    if (Replay.idx >= 0 && snaps[Replay.idx]) return snapshotBundle(snaps[Replay.idx]);
    return { usage: Live.usage, usageSrc: Live.usageSrc, subs: Live.subs, gemini: Live.gemini, openai: Live.openai, chat: Live.chat };
  }

  // ---------- 統一口徑的額度列：條＝已用 %，主標＝已用 %，右下角＝原始數字 ----------
  function qRow(o) {
    const has = typeof o.used === 'number' && Number.isFinite(o.used);
    const t = o.stale ? 'stale' : P.tier(o.used), col = P.COLORS[t];
    const mine = typeof o.mine === 'number' ? Math.max(0, Math.min(100, o.mine)) : null;
    const bar = !has ? '<i style="width:0"></i>'
      : mine != null ? `<i class="pool" style="width:${Math.min(100, o.used)}%;background:${col}"></i><i class="mine" style="width:${mine}%;background:${o.mineColor || '#fff'}"></i>`
      : `<i style="width:${Math.min(100, o.used)}%;background:${col}"></i>`;
    const shown = o.primary != null ? o.primary : o.used;
    return `<div class="q-row t-${t}${o.big ? ' big' : ''}">
      <div class="q-top"><span class="q-name">${esc(o.name)}</span>${o.tag || ''}<b class="q-pct">${has ? fmtPct(shown) : '—'}<small>${has ? '已用' : ''}</small></b></div>
      <div class="bar${o.big ? ' big' : ''}" role="progressbar" aria-label="${esc(o.aria || o.name)}（已用 %）" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${has ? Math.round(shown) : 0}">${bar}</div>
      <div class="q-sub"><span>${o.meta || ''}</span><span class="q-raw">${o.raw || ''}</span></div>
    </div>`;
  }
  const tag = (cls, text) => `<span class="tag ${cls}">${esc(text)}</span>`;
  const resetMeta = (iso, detailed) => iso ? `重置 ${fmtDate(iso)}${detailed ? `（${fmtLeft(iso)}）` : ''}` : '';
  function poolRow(p, extra) {
    if (!p) return '';
    const tg = (p.stale ? tag('stale', '資料過期') : '') + (p.charging ? tag('warn', p.limited ? '已限流' : '已滿載') : '');
    return qRow(Object.assign({ name: p.name, used: p.used, stale: p.stale, raw: p.raw, meta: resetMeta(p.reset, true), tag: tg }, extra || {}));
  }

  // 每位夥伴卡片上的額度列
  function agentRows(id, B, built, detailed) {
    const pools = Object.fromEntries(built.pools.map(p => [p.id, p]));
    const u = B.usage || { entries: [] }, rows = [];
    if (id === 'gpt') {
      const p = pools.openai; if (!p) return '<div class="u-empty">尚無 OpenAI 花費資料</div>';
      rows.push(poolRow(p, { name: 'OpenAI API 本月', meta: `今日 ${fmtUsd(p.today)} · ${resetMeta(p.reset, detailed)}`, raw: p.raw }));
      if (detailed && B.openai) rows.push(`<div class="u-meta">${esc(B.openai.model)} · 上次執行 ${fmtDate(B.openai.last_run_at)} · 無每日上限、每月硬上限 $${B.openai.monthly_cap_usd}</div>`);
      return rows.join('');
    }
    if (id === 'gemini') {
      const p = pools.gemini_api; if (!p) return '<div class="u-empty">尚無 Gemini API 資料</div>';
      rows.push(poolRow(p, { meta: p.reset ? resetMeta(p.reset, detailed) : (p.note ? esc(p.note) : '今日尚未使用') }));
      if (detailed && B.gemini) rows.push(`<div class="u-meta">${esc(B.gemini.model)} · 上次執行 ${fmtDate(B.gemini.last_run_at)} · 與 Google AI Pro 訂閱分開</div>`);
      return rows.join('');
    }
    const list = (u.entries || []).filter(e => e.agent_id === id);
    if (!list.length) return '<div class="u-empty">尚無額度資料</div>';
    if (u.is_demo) {   // 讀不到真實資料時的示範數字（同樣換成已用 %）
      return list.map(e => qRow({ name: `${e.provider} · ${e.window}`, used: e.limit ? e.used / e.limit * 100 : null, raw: `${fmtNum(e.used)} / ${fmtNum(e.limit)} ${esc(e.unit || '')}`, meta: resetMeta(e.reset_at), tag: tag('demo', '示範') })).join('');
    }
    const team = pools.team, share = list.find(e => e.provider === 'grok-bot' && typeof e.share_pct === 'number' && e.connected !== false);
    if (share && team) {
      const label = share.share_label && String(share.share_label).startsWith('<') ? share.share_label + '%' : fmtNum(share.share_pct) + '%';
      rows.push(qRow({ name: 'Grok Bot 共用池', used: team.used, primary: share.used, mine: share.used, mineColor: cfgById[id] && cfgById[id].color, stale: team.stale,
        raw: `佔全隊 ${label}`, meta: `池已用 ${fmtPct(team.used)}${detailed ? ' · ' + resetMeta(team.reset, true) : ''}`, aria: `${cfgById[id].name} 佔團隊每週額度`,
        tag: team.stale ? tag('stale', '資料過期') : '' }));
    }
    if (id === 'codex-xiao-zhaowang') {
      const ce = list.find(e => e.scope === 'own' && (e.slot === 'primary' || e.window === 'primary'));
      if (pools.codex) rows.push(poolRow(pools.codex, { name: 'Codex 獨立額度', meta: pools.codex.stale ? '等小沼王下次回報' : resetMeta(pools.codex.reset, detailed) }));
      else if (ce) rows.push(`<div class="q-row nc"><div class="q-top"><span class="q-name">Codex 獨立額度</span>${tag('nc', '尚未回報')}</div></div>`);
      if (detailed && ce) rows.push(`<div class="u-meta">Codex 回報於 ${fmtDate(ce.updated_at)} · 不算在團隊額度內</div>`);
    }
    for (const e of list) if (e.connected === false && e.scope !== 'own') rows.push(`<div class="q-row nc"><div class="q-top"><span class="q-name">${esc(e.provider)}</span>${tag('nc', '尚未接上')}</div></div>`);
    return rows.join('') || '<div class="u-empty">尚無額度資料</div>';
  }

  // ---------- 頁首警戒橫幅 ----------
  function renderBanner(B, built) {
    const box = $('#alertBanner'), pillEl = $('#healthPill');
    const w = built.worst, lv = built.level, replay = Replay.idx >= 0;
    const rp = replay ? `<span class="ab-replay">⏪ 回放 ${fmtDate(B.snapshotAt)}</span>` : '';
    const top = built.top3.map(x => `${esc((cfgById[x.id] || { short: x.id }).short)} ${x.label && String(x.label).startsWith('<') ? esc(x.label) : fmtNum(x.share)}%`).join('、');
    const stale = built.staleList.filter(p => !p.minor);
    const staleTxt = stale.length ? `⏳ 資料過期：${stale.map(p => `${esc(p.short || p.name)}（${fmtAge(p.updated)}更新）`).join('、')}` : '';
    let html = '';
    if (lv === 'red' || lv === 'amber') {
      const red = lv === 'red';
      const route = built.headroom.map(p => `${p.id === 'gemini_api' ? 'Gemini 計算員' : p.id === 'claude' ? 'Claude' : p.id === 'gemini_sub' ? 'Gemini（AI Pro）' : 'Codex'}（剩 ${fmtNum(100 - p.used)}%）`).join(' / ');
      const consumers = w.id === 'team' && top ? `<span class="ab-seg">前 3 大用量：${top}</span>` : (w.agents && w.agents.length ? `<span class="ab-seg">使用者：${w.agents.map(id => esc((cfgById[id] || { short: id }).short)).join('、')}</span>` : '');
      html = `<div class="ab ${lv}">${rp}<b class="ab-title">${red ? '🔴 額度警戒' : '🟡 額度注意'}</b>
        <span class="ab-seg"><b>${esc(w.name)}</b> 已用 <b>${fmtPct(w.used)}</b>（${esc(w.raw)}）${w.reset ? ` · ${resetMeta(w.reset, true)}` : ''}</span>
        ${consumers}
        ${red ? `<span class="ab-seg ab-route">建議：${route ? `把重複運算改派 ${route}` : '暫停非必要任務，等額度重置'}</span>` : ''}
        ${staleTxt ? `<span class="ab-seg ab-stale">${staleTxt}</span>` : ''}</div>`;
      pillEl.hidden = true;
    } else {
      pillEl.hidden = false;
      pillEl.className = 'health-pill' + (stale.length ? ' stale' : '');
      pillEl.innerHTML = `<i></i>${replay ? '回放 · ' : ''}額度正常${w ? ` · 最高 ${esc(w.short)} ${fmtPct(w.used)}` : ''}`;
      pillEl.title = built.pools.filter(p => !p.minor).map(p => `${p.name}：已用 ${fmtPct(p.used)}（${p.raw}）`).join('\n');
      if (staleTxt || replay) html = `<div class="ab ${staleTxt ? 'stale' : 'info'} slim">${rp}${staleTxt ? `<span class="ab-seg">${staleTxt}，數字僅供參考</span>` : '<span class="ab-seg">正在檢視歷史快照，按「即時」回到現在</span>'}</div>`;
    }
    box.innerHTML = html; box.hidden = !html;
    box.setAttribute('role', lv === 'red' ? 'alert' : 'status');
  }

  // ---------- 時間戳分層：資料快照時間（額度 JSON） vs 最後對話時間（chat.json） ----------
  function renderStamps(B, built) {
    const t = (B.usage && (B.usage.entries || []).find(e => e.agent_id === 'team'));
    const snapAt = (t && t.updated_at) || (B.usage && B.usage.generated_at);
    const hs = $('#snapStamp');
    if (B.usageSrc !== 'file') hs.innerHTML = '<i class="dot-s warn"></i>讀不到額度資料，暫時顯示示範數字';
    else hs.innerHTML = `<i class="dot-s ${Live.usageErr && Replay.idx < 0 ? 'warn' : ageH(snapAt) > A.staleHours ? 'old' : 'ok'}"></i>資料快照 <b>${fmtDate(snapAt)}</b>（${fmtAge(snapAt)}）${Live.usageErr && Replay.idx < 0 ? ' · 連線中斷' : ''}`;
    hs.title = '額度 JSON 的快照時間（台北時間）。網站只讀取公開 JSON：唯讀監控，每分鐘自動刷新一次快照。';
    const src = { usage: snapAt, codex: (built.pools.find(p => p.id === 'codex') || {}).updated, subs: B.subs && B.subs.updated_at, openai: B.openai && B.openai.last_run_at, gemini: B.gemini && B.gemini.last_run_at };
    const bits = [['團隊額度', src.usage], ['Codex', src.codex], ['訂閱', src.subs], ['OpenAI', src.openai], ['Gemini API', src.gemini]].filter(x => x[1])
      .map(([n, v]) => `<span class="${ageH(v) > A.staleHours && n !== 'OpenAI' && n !== 'Gemini API' ? 'old' : ''}">${n} ${fmtDate(v)}</span>`);
    $('#snapLayers').innerHTML = `<b>資料快照時間</b>${bits.join('')}<em>${Replay.idx >= 0 ? '（回放中）' : `讀取於 ${Live.usageLoadedAt ? fmtT.format(Live.usageLoadedAt) : '—'}`}</em>`;
  }

  // ---------- 額度總覽（6 個池，一律已用 %） ----------
  function renderPools(B, built) {
    const pools = Object.fromEntries(built.pools.map(p => [p.id, p]));
    const card = (cls, title, body, extra) => `<div class="pool-card ${cls}">${extra || ''}<div class="pc-head"><b>${title}</b></div>${body}</div>`;
    const out = [];
    const t = pools.team;
    if (t) {
      const u = B.usage, ranked = (u.entries || []).filter(e => e.provider === 'grok-bot' && e.agent_id !== 'team' && e.connected !== false && e.share_pct > 0 && cfgById[e.agent_id]).sort((x, y) => y.share_pct - x.share_pct);
      out.push(card('team', 'Grok Bot 團隊每週 <span class="muted">全員共用</span>', poolRow(t, { name: '團隊每週額度', big: true }) +
        `<div class="stack" title="各 Agent 佔團隊用量">${ranked.map(x => `<i style="width:${x.share_pct}%;background:${cfgById[x.agent_id].color}" title="${esc(cfgById[x.agent_id].name)} ${x.share_pct}%"></i>`).join('')}</div>
         <div class="legend">${ranked.map(x => `<span><i style="background:${cfgById[x.agent_id].color}"></i>${esc(cfgById[x.agent_id].short)} ${x.share_label && String(x.share_label).startsWith('<') ? esc(x.share_label) : fmtNum(x.share_pct)}%</span>`).join('')}</div>`));
    }
    if (pools.codex) out.push(card('codex', 'Codex <span class="muted">小沼王獨立額度</span>', poolRow(pools.codex, { name: '主要額度' })));
    if (pools.claude || pools.claude_5h) out.push(card('claude', `Claude ${esc((B.subs && B.subs.claude && B.subs.claude.plan) || '')} <span class="muted">訂閱</span>`, poolRow(pools.claude, { name: '本週' }) + poolRow(pools.claude_5h, { name: '五小時' })));
    if (pools.gemini_sub || pools.gemini_cur) out.push(card('gsub', `Gemini <span class="muted">${esc((B.subs && B.subs.gemini && B.subs.gemini.plan) || '')} 訂閱</span>`, poolRow(pools.gemini_sub, { name: '每週' }) + poolRow(pools.gemini_cur, { name: '目前時段' })));
    if (pools.gemini_api) out.push(card('gapi', 'Gemini API <span class="muted">計算員免費額度</span>', poolRow(pools.gemini_api, { meta: pools.gemini_api.reset ? resetMeta(pools.gemini_api.reset, true) : esc(pools.gemini_api.note || '今日尚未使用') })));
    if (pools.openai) out.push(card('oai', 'OpenAI API <span class="muted">量化分析師</span>', poolRow(pools.openai, { name: '本月花費', meta: `今日 ${fmtUsd(pools.openai.today)} · ${resetMeta(pools.openai.reset)}` })));
    $('#poolGrid').innerHTML = out.join('');
    $('#usageBadge').hidden = !(B.usage && B.usage.is_demo);
    $('#usageLive').hidden = !!(B.usage && B.usage.is_demo);
    const al = $('#usageAlert'), msgs = [];
    if (Replay.idx < 0 && Live.usageErr && Live.usageSrc === 'file') msgs.push(`⚠️ 最近一次讀取額度失敗（${esc(Live.usageErr)}），先顯示 ${fmtT.format(Live.usageLoadedAt)} 讀到的資料，會自動重試。`);
    else if (B.usageSrc !== 'file') msgs.push('⚠️ 讀不到 usage.json，下方是內建示範數字，不是真實用量。');
    al.hidden = !msgs.length; al.innerHTML = msgs.join('<br>');
  }

  // ---------- Agent 卡片（部門分組，5×2 / 2×5 對稱格） ----------
  function buildCards() {
    // 寬螢幕的部門標頭：每列兩個部門，標頭橫跨該部門的卡片數
    const head = DEPTS.map(d => ({ d, n: C.agents.filter(a => a.dept === d.id).length }));
    let html = '';
    // 依列輸出：標頭列 → 卡片列
    const deptRows = []; let acc = [], cnt = 0;
    for (const h of head) { acc.push(h); cnt += h.n; if (cnt >= 5) { deptRows.push(acc); acc = []; cnt = 0; } }
    if (acc.length) deptRows.push(acc);
    html = deptRows.map(r => r.map(({ d, n }) => `<div class="dept-h" style="--dc:${d.color};grid-column:span ${n}"><b>${esc(d.name)}</b><span>${n} 位</span></div>`).join('') +
      r.flatMap(({ d }) => C.agents.filter(a => a.dept === d.id)).map(cardHTML).join('')).join('');
    const rest = C.agents.filter(a => !deptById[a.dept]); html += rest.map(cardHTML).join('');
    $('#cards').innerHTML = html;
    $('#cards').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) pick(c.dataset.id, 'card'); });
    $('#agentCount').textContent = `Agents: ${C.agents.length}`;
    $('#detailPicker').innerHTML = ORDER.map(a => `<button type="button" class="dp-item" data-id="${a.id}" style="--c:${a.color}">${avatarImg(a, 2)}<span><b>${esc(a.short)}</b><small>${esc((deptById[a.dept] || {}).name || '')}</small></span><i class="dot"></i></button>`).join('');
    $('#detailPicker').addEventListener('click', e => { const b = e.target.closest('.dp-item'); if (b) pick(b.dataset.id, 'picker'); });
    if (ASSETS.artCredit || ASSETS.geminiArtCredit) {
      const ac = $('#artCredit'); ac.hidden = false;
      ac.textContent = ' · ' + [ASSETS.artCredit && `角色美術：${ASSETS.artCredit}`, ASSETS.geminiArtCredit].filter(Boolean).join(' · ');
    }
  }
  function cardHTML(a) {
    const d = deptById[a.dept] || {};
    return `<button type="button" class="card" data-id="${a.id}" style="--c:${a.color};--dc:${d.color || '#888'}" aria-label="${esc(a.name)}，${esc(a.role)}，點一下看角色詳情">
        <div class="card-top">${avatarImg(a, 4, 'av')}<div class="card-id"><b>${esc(a.name)}</b><span class="role" title="${esc(a.role)}">${esc(a.role)}</span></div></div>
        <div class="card-meta"><span class="dept-chip">${esc(d.name || '')}</span><span class="status"><i></i><em></em></span></div>
        <div class="sig"></div>
        <div class="usage"></div>
      </button>`;
  }
  function sigTags(id) {
    const s = (D.signals() || {})[id]; if (!s) return '';
    const t = [];
    if (s.charging) t.push(tag('warn', '充電中'));
    else if (s.load) t.push(tag('hot', '高負載'));
    if (s.hot) t.push(tag('live', '正在執行'));
    else if (s.active || s.boost) t.push(tag('live', '近期活躍'));
    if (!t.length) t.push(tag('idle', '巡遊中'));
    return t.join('');
  }

  // ---------- 刷新：所有畫面都從同一份 bundle + pools 算出來 ----------
  let lastBuilt = null, lastBundle = null;
  function refresh(opts) {
    const B = bundle(), now = Replay.idx >= 0 ? Date.parse(B.snapshotAt) : Date.now();
    NOW = () => (Replay.idx >= 0 ? Date.parse(B.snapshotAt) : Date.now());
    const built = P.build(B, now);
    lastBuilt = built; lastBundle = B;
    D.update(B, built, Live.history, now, { replay: Replay.idx >= 0, force: opts && opts.force });
    O.setPools(built.pools);
    const oai = built.pools.find(p => p.id === 'openai');
    O.setRoomInfo('quant', oai ? { text: `今日 ${fmtUsd(oai.today)} · 本月 ${fmtUsd(oai.month)} / $${oai.cap}`, pct: oai.used, color: P.COLORS[oai.tier] } : null);
    O.setMapBanner(Replay.idx >= 0 ? `⏪ 回放 ${fmtDate(B.snapshotAt)}（按「即時」回到現在）` : null);
    renderBanner(B, built); renderStamps(B, built); renderPools(B, built);
    for (const a of C.agents) {
      const card = document.querySelector(`.card[data-id="${a.id}"]`); if (!card) continue;
      card.querySelector('.usage').innerHTML = agentRows(a.id, B, built, false);
      card.querySelector('.sig').innerHTML = sigTags(a.id);
    }
    renderReplay();
    if (selId) renderDetail();
  }

  // ---------- 右側分頁：全員群聊｜角色詳情（不再用蓋住地圖的 popover） ----------
  let selId = null;
  function setTab(name, focus) {
    for (const t of ['chat', 'detail']) {
      const on = t === name;
      $(`#tab-${t}`).setAttribute('aria-selected', String(on)); $(`#tab-${t}`).tabIndex = on ? 0 : -1;
      $(`#panel-${t}`).hidden = !on;
    }
    if (focus) $(`#tab-${name}`).focus();
  }
  $('.tabs').addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) setTab(b.dataset.tab); });
  $('.tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cur = $('#tab-chat').getAttribute('aria-selected') === 'true' ? 'chat' : 'detail';
    setTab(cur === 'chat' ? 'detail' : 'chat', true);
  });
  function pick(id, from) {
    if (O.getSelected() === id && from !== 'map') { O.select(null); return; }
    O.select(id, from);
  }
  O.onSelect((id, from) => {
    selId = id;
    tickStatus(true);
    if (!id) { renderDetail(); return; }
    renderDetail(); setTab('detail');
    if (isNarrow()) {
      if (from === 'map') showMapChip(id);
      else $('#sidebar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  function showMapChip(id) {
    const chip = $('#mapChip'), a = cfgById[id]; if (!a) return;
    chip.innerHTML = `👤 ${esc(a.short)} 的角色詳情 ↓`; chip.hidden = false;
    clearTimeout(showMapChip.t); showMapChip.t = setTimeout(() => { chip.hidden = true; }, 5000);
  }
  $('#mapChip').addEventListener('click', () => { $('#mapChip').hidden = true; $('#sidebar').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  function renderDetail() {
    const box = $('#detailBody'), picker = $('#detailPicker'), a = cfgById[selId];
    picker.querySelectorAll('.dp-item').forEach(b => b.classList.toggle('sel', b.dataset.id === selId));
    if (!a) { box.innerHTML = '<div class="detail-empty">點地圖上的角色、下方的 Agent 卡片，或上面的頭像，就會在這裡看到詳細資訊；地圖不會被遮住。</div>'; return; }
    const B = lastBundle || bundle(), built = lastBuilt || P.build(B, NOW());
    const d = deptById[a.dept] || {}, s = (D.signals() || {})[a.id] || {};
    const live = a.id === 'gemini' ? !!B.gemini : a.id === 'gpt' ? !!B.openai : !(B.usage && B.usage.is_demo);
    box.innerHTML = `
      <div class="pv-head" style="--c:${a.color}">
        ${avatarImg(a, 4)}
        <div><b id="pvName">${esc(a.name)}</b><div class="pv-role">${esc(a.role)}</div><div class="pv-zone"><span class="dept-chip" style="--dc:${d.color}">${esc(d.name || '')}</span> 座位：${esc(C.zones[a.zone] || '')}${a.altSeats ? '・圖面審查室' : ''}</div></div>
        <button type="button" class="pv-close" data-pv="close" aria-label="取消選取">✕</button>
      </div>
      ${ASSETS.portraits && ASSETS.portraits[a.id] ? `<img class="pv-portrait" src="${esc(ASSETS.portraits[a.id])}" alt="${esc(a.name)} 角色立繪" data-optional="1" loading="lazy" decoding="async">` : ''}
      <div class="pv-status" id="pvStatus" aria-live="off"></div>
      <div class="pv-sig">${sigTags(a.id)}<span class="muted">${esc((s.reasons || []).join('；'))}</span></div>
      <p class="pv-intro">${esc(a.intro)}</p>
      <div class="pv-sec">額度（已用 %）${live ? tag('live', Replay.idx >= 0 ? '回放快照' : '真實用量') : '<span class="muted">尚無資料</span>'}</div>
      <div class="pv-usage">${agentRows(a.id, B, built, true)}</div>
      <div class="pv-actions">
        <button type="button" data-pv="working">💻 回座工作</button>
        <button type="button" data-pv="meeting">📋 去開會</button>
        <button type="button" data-pv="idle">☕ 去休息</button>
        <button type="button" data-pv="chat">💬 看群聊</button>
      </div>
      <div class="pv-foot muted">手動指令約 20–30 秒後${D.isEnabled() ? '回到自動狀態（依 JSON 資料）' : '回到隨機行為'}。</div>`;
    tickStatus(true);
  }
  $('#detailBody').addEventListener('click', e => {
    const b = e.target.closest('[data-pv]'); if (!b || !selId) return;
    const act = b.dataset.pv;
    if (act === 'close') { O.select(null); return; }
    if (act === 'chat') { setTab('chat'); return; }
    const a = O.byId[selId]; if (a) a.manual = Date.now() + 30000;
    O.setState(selId, act, act === 'working' ? 30 : 20);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && O.getSelected()) O.select(null); });

  const lastSt = {};
  function tickStatus(force) {
    if (document.hidden) return;
    for (const a of O.agents) {
      const st = O.statusOf(a), sel = O.getSelected() === a.id, sig = st.label + sel;
      if (!force && lastSt[a.id] === sig) continue;
      lastSt[a.id] = sig;
      const card = document.querySelector(`.card[data-id="${a.id}"]`);
      if (card) { card.querySelector('.status em').textContent = st.label; card.querySelector('.status i').style.background = st.color; card.classList.toggle('sel', sel); card.setAttribute('aria-pressed', String(sel)); }
      const dp = document.querySelector(`.dp-item[data-id="${a.id}"] .dot`); if (dp) { dp.style.background = st.color; dp.title = st.label; }
    }
    if (selId) { const a = O.byId[selId], st = O.statusOf(a), el = $('#pvStatus'); if (el) el.innerHTML = `<i style="background:${st.color}"></i>${st.label} · ${esc(O.activityOf(a))}`; }
  }

  // ---------- 全員群聊（真實紀錄，唯讀） ----------
  const log = $('#chatLog');
  const chatUrl = C.chatUrl || 'data/chat.json';
  const LONG = 400;
  const Chat = { data: null, sig: '', seen: null, expanded: new Set(), error: '' };
  const textHTML = t => esc(t).replace(/\n/g, '<br>');
  function bubbleHTML(key, text) {
    const t = String(text || '');
    if (t.length <= LONG) return `<div class="bubble">${textHTML(t)}</div>`;
    const open = Chat.expanded.has(key);
    return `<div class="bubble long${open ? ' open' : ''}" data-key="${esc(key)}">${textHTML(t)}</div><button class="more" data-key="${esc(key)}">${open ? '收合' : '展開全文'}（${t.length} 字）</button>`;
  }
  const unknownAvatar = name => `<span class="av-unk">${esc((name || '?').trim().charAt(0) || '?')}</span>`;
  function msgHTML(m, key) {
    const at = m.at ? `<span class="at">${fmtDate(m.at)}</span>` : '';
    if (m.from === 'system') return `<div class="msg system"><div class="note sys">${textHTML(m.text)} ${at}</div></div>`;
    if (m.from === 'user') return `<div class="msg user"><div class="who">Hank ${at}</div>${bubbleHTML(key, m.text)}</div>`;
    const a = cfgById[m.from];
    const name = a ? a.name : (m.name || m.from || '未知夥伴');
    return `<div class="msg agent" style="--c:${a ? a.color : '#8a93b8'}">${a ? avatarImg(a, 2) : unknownAvatar(name)}<div class="m-body"><div class="who">${esc(name)} ${at}</div>${bubbleHTML(key, m.text)}</div></div>`;
  }
  function roundHTML(r, i) {
    const n = /^r(\d+)$/.test(r.id || '') ? r.id.slice(1) : i + 1;
    const msgs = Array.isArray(r.messages) ? r.messages : [];
    let h = `<div class="msg system"><div class="round">第 ${esc(n)} 輪 · ${esc(r.title || '群聊')} <span class="tag live">真實</span>${r.started_at ? ` <span class="at">${fmtDate(r.started_at)}</span>` : ''}</div></div>`;
    h += msgs.map((m, j) => msgHTML(m || {}, `${r.id}:${j}`)).join('');
    const ids = [...new Set(msgs.map(m => m && m.from).filter(f => f && f !== 'user' && f !== 'system'))];
    if (r.done) { if (ids.length) h += `<div class="msg system"><div class="done">✓ 討論完成<div class="chips">${ids.map(id => `<span>✓ ${esc(cfgById[id] ? cfgById[id].short : id)} 已回覆</span>`).join('')}</div></div></div>`; }
    else h += `<div class="msg system"><div class="typing">夥伴回覆中…（自動刷新）</div></div>`;
    return h;
  }
  function lastTalkAt(j) {
    let best = NaN;
    for (const r of (j && j.rounds) || []) for (const m of r.messages || []) { const t = Date.parse(m && m.at); if (Number.isFinite(t) && !(t <= best)) best = t; }
    return Number.isFinite(best) ? new Date(best).toISOString() : (j && j.updated_at);
  }
  function renderChat() {
    const rounds = Chat.data && Array.isArray(Chat.data.rounds) ? Chat.data.rounds : [];
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const prevTop = log.scrollTop;
    const talked = rounds.some(r => (r.messages || []).some(m => m && m.from !== 'system'));
    const howto = `<div class="chat-howto"><b>💡 群聊怎麼運作</b><ol><li>Hank 在 Grok Bot 說「群聊：…」（全員）或「@名字 …」（指定夥伴）——可以用上面的按鈕複製指令</li><li>Grok Bot → 澳洲企鵝把話轉給夥伴，收集他們的<b>真實回覆</b>（地圖上會看到企鵝走去交接）</li><li>回覆會整理成一輪對話，自動顯示在這裡，角色頭上也會冒出對話泡泡</li></ol><small>目前還沒有夥伴的真實回覆，第一輪群聊開始後就會出現。</small></div>`;
    log.innerHTML = rounds.length ? rounds.map(roundHTML).join('') + (talked ? '' : howto) : `<div class="chat-empty">還沒有對話</div>` + howto;
    const ca = $('#chatAlert');
    ca.hidden = !Chat.error;
    ca.textContent = Chat.error ? `⚠️ 讀取群聊失敗（${Chat.error}），${Chat.data ? '先顯示上次的紀錄，' : ''}會自動重試。` : '';
    if (atBottom || !Chat.rendered) log.scrollTop = log.scrollHeight; else log.scrollTop = prevTop;
    Chat.rendered = true;
    const lt = lastTalkAt(Chat.data);
    $('#chatUpdated').innerHTML = lt ? `最後對話時間 <b>${fmtDate(lt)}</b>` : '還沒有對話';
  }
  async function loadChat() {
    try {
      const j = await getJSON(chatUrl);
      if (!j || !Array.isArray(j.rounds)) throw new Error('格式不符');
      const hadErr = !!Chat.error; Chat.error = '';
      const sig = JSON.stringify(j);
      if (sig === Chat.sig && Chat.rendered) { if (hadErr) renderChat(); return; }
      const first = Chat.seen === null, seen = new Set(), fresh = [];
      for (const rd of j.rounds) (rd.messages || []).forEach((m, k) => {
        const key = `${rd.id}:${k}`; seen.add(key);
        if (!first && !Chat.seen.has(key) && m && cfgById[m.from]) fresh.push(m);
      });
      Chat.data = j; Chat.sig = sig; Chat.seen = seen; Live.chat = j;
      renderChat();
      if (!first) refresh();
      fresh.forEach((m, i) => setTimeout(() => { const t = String(m.text).replace(/\s+/g, ' '); O.say(m.from, t.length > 12 ? t.slice(0, 12) + '…' : t, 5000); }, i * 1800));
    } catch (e) { Chat.error = String(e.message || e); renderChat(); }
  }
  log.addEventListener('click', e => {
    const b = e.target.closest('button.more'); if (!b) return;
    const k = b.dataset.key, open = !Chat.expanded.has(k);
    open ? Chat.expanded.add(k) : Chat.expanded.delete(k);
    const bub = b.previousElementSibling; bub.classList.toggle('open', open);
    b.textContent = `${open ? '收合' : '展開全文'}（${bub.textContent.length} 字）`;
    b.setAttribute('aria-expanded', String(open));
  });

  // 一鍵複製 @指令（網站不能發話：複製後到 Grok Bot 貼上）
  const CMDS = ['群聊：', '@澳洲企鵝 ', '@量化分析師 ', '@大主人 ', '@小主人 ', '@小沼王 ', '@Gemini ', '@GPT '];
  $('#cmdChips').innerHTML = CMDS.map(c => `<button type="button" class="cmd" data-cmd="${esc(c)}" title="複製「${esc(c.trim())}」，到 Grok Bot 貼上後接著打內容">${esc(c.trim())}</button>`).join('');
  async function copyText(t) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch (e) {}
    const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); return ok;
  }
  $('#cmdChips').addEventListener('click', async e => {
    const b = e.target.closest('.cmd'); if (!b) return;
    const ok = await copyText(b.dataset.cmd);
    b.classList.add(ok ? 'copied' : 'fail'); b.dataset.label = b.textContent; b.textContent = ok ? '已複製 ✓' : '請手動複製';
    toast(ok ? `已複製「${b.dataset.cmd.trim()}」，到 Grok Bot 貼上接著打內容` : `複製失敗，請手動輸入「${b.dataset.cmd.trim()}」`);
    setTimeout(() => { b.classList.remove('copied', 'fail'); b.textContent = b.dataset.label; }, 1600);
  });
  function toast(t) {
    const el = $('#toast'); el.textContent = t; el.hidden = false; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); }, 2200);
  }

  // ---------- 今日時間軸（Day Replay） ----------
  const rpRange = $('#rpRange'), rpTime = $('#rpTime'), rpPlay = $('#rpPlay'), rpLive = $('#rpLive'), rpInfo = $('#rpInfo');
  function renderReplay() {
    const snaps = snapshots(), n = snaps.length;
    rpRange.max = String(Math.max(0, n - 1)); rpRange.disabled = n < 2;
    const live = Replay.idx < 0;
    rpRange.value = String(live ? Math.max(0, n - 1) : Replay.idx);
    const s = live ? null : snaps[Replay.idx];
    rpTime.textContent = live ? '即時' : fmtDate(s.t);
    rpLive.setAttribute('aria-pressed', String(live)); rpLive.classList.toggle('on', live);
    rpPlay.disabled = n < 2;
    rpPlay.innerHTML = Replay.playing ? '⏸ <span>暫停</span>' : '▶ <span>播放</span>';
    rpInfo.textContent = n ? `${n} 筆快照 · ${fmtT.format(new Date(snaps[0].t))}–${fmtT.format(new Date(snaps[n - 1].t))}${n < 2 ? '（每 2 小時同步累積）' : ''}` : '尚無快照（同步排程會自動累積）';
    $('#replay').classList.toggle('replaying', !live);
    $('#rpTicks').innerHTML = snaps.map((x, i) => { const w = x.worst ? x.worst[1] : 0; return `<i style="left:${n > 1 ? i / (n - 1) * 100 : 50}%;background:${P.color(w)}" title="${fmtDate(x.t)} 最高 ${fmtPct(w)}"></i>`; }).join('');
  }
  function goReplay(i) {
    const n = snapshots().length; if (!n) return;
    Replay.idx = Math.max(0, Math.min(n - 1, i));
    refresh({ force: true });
  }
  function goLive() { stopPlay(); if (Replay.idx < 0) return; Replay.idx = -1; refresh({ force: true }); }
  function stopPlay() { Replay.playing = false; clearInterval(Replay.timer); renderReplay(); }
  rpRange.addEventListener('input', () => { stopPlay(); goReplay(+rpRange.value); });
  rpLive.addEventListener('click', goLive);
  rpPlay.addEventListener('click', () => {
    if (Replay.playing) return stopPlay();
    const n = snapshots().length; if (n < 2) return;
    if (Replay.idx < 0 || Replay.idx >= n - 1) goReplay(0);
    Replay.playing = true; renderReplay();
    Replay.timer = setInterval(() => { if (Replay.idx >= snapshots().length - 1) { stopPlay(); return; } goReplay(Replay.idx + 1); }, 1400);
  });

  // ---------- 工具列（三組：場景行為／模擬與同步／音訊） ----------
  function setBtn(b, icon, label, pressed) { b.innerHTML = `${icon} <span>${label}</span>`; b.setAttribute('aria-pressed', String(!!pressed)); }
  const autoBtn = $('#autoBtn');
  const syncAuto = () => { setBtn(autoBtn, D.isEnabled() ? '🤖' : '🎲', D.isEnabled() ? '自動狀態' : '隨機模式', D.isEnabled()); autoBtn.title = D.isEnabled() ? '目前依 JSON 資料驅動角色（按一下改成隨機走動）' : '目前角色隨機走動（按一下改回依 JSON 資料驅動）'; };
  syncAuto();
  $('.tools').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const back = D.isEnabled() ? '後回到自動狀態' : '後回到隨機行為';
    switch (b.dataset.act) {
      case 'meeting': O.setAll('meeting', 25); toast(`📋 全員到會議室，約 25 秒${back}`); break;
      case 'work': O.setAll('working', 30); toast(`💻 全員回座，約 30 秒${back}`); break;
      case 'break': O.setAll('idle', 20); toast(`☕ 全員去休息，約 20 秒${back}`); break;
      case 'auto': D.setEnabled(!D.isEnabled()); syncAuto(); refresh({ force: true }); toast(D.isEnabled() ? '🤖 已開啟自動狀態：角色行為跟著額度與群聊資料' : '🎲 已改成隨機模式'); break;
      case 'pause': { const p = O.togglePause(); setBtn(b, p ? '▶' : '⏸', p ? '繼續' : '暫停', p); break; }
      case 'labels': { const on = O.toggleLabels(); b.classList.toggle('off', !on); b.setAttribute('aria-pressed', String(on)); break; }
      case 'reload': b.classList.add('spin'); Promise.all([loadAll(), loadChat()]).finally(() => setTimeout(() => b.classList.remove('spin'), 300)); break;
      case 'zoom': { const z = $('#mapWrap').classList.toggle('zoomed'); setBtn(b, '🔍', z ? '符合寬度' : '放大地圖', z); break; }
      case 'bgm': Bgm.toggle(); break;
      case 'bgmNext': Bgm.next(); break;
    }
  });

  // ---------- 背景音樂：預設靜音，使用者按了才播放；用 Web Audio 無縫循環；可切換曲目 ----------
  const Bgm = (() => {
    const cfg = ASSETS.bgm || {}, btn = $('#bgmBtn'), nextBtn = $('#bgmNextBtn'), credit = $('#bgmCredit'), nowEl = $('#bgmNow');
    const KEY = 'aiOffice.bgm', TKEY = 'aiOffice.bgmTrack';
    const all = (cfg.tracks || (cfg.ogg || cfg.mp3 ? [cfg] : [])).filter(t => t.ogg || t.mp3);
    if (!all.length) return { toggle() {}, next() {} };
    const vol = cfg.volume || 0.5;
    const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
    let tracks = [], idx = 0, ctx = null, gain = null, src = null, el = null, mode = null, playing = false, busy = false;
    const bufs = new Map();
    const cur = () => tracks[idx];
    const sync = (state) => {
      const map = { on: ['🔊', '音樂播放中'], off: ['🔇', '背景音樂'], load: ['⏳', '載入音樂…'], hint: ['🎵', '點我播音樂'] };
      const [ic, lb] = map[state]; setBtn(btn, ic, lb, state === 'on');
      btn.classList.toggle('hint', state === 'hint');
      btn.title = `《${cur().title}》· 作曲：${cur().credit}` + (state === 'on' ? '（再按一次靜音）' : '（按一下播放，預設靜音）');
      credit.textContent = ` · 背景音樂《${cur().title}》作曲：${cur().credit}`;
      if (nextBtn) nextBtn.title = `換下一首（共 ${tracks.length} 首，目前第 ${idx + 1} 首）`;
      if (nowEl) { nowEl.hidden = false; nowEl.classList.toggle('on', state === 'on'); nowEl.innerHTML = `<b>${idx + 1}/${tracks.length}</b> ${esc(cur().title)}`; nowEl.title = `目前曲目：《${cur().title}》· 作曲：${cur().credit}`; }
    };
    const fail = () => { playing = false; busy = false; btn.hidden = true; credit.hidden = true; if (nextBtn) nextBtn.hidden = true; if (nowEl) nowEl.hidden = true; };
    async function loadBuf(t) {
      if (bufs.has(t)) return bufs.get(t);
      for (const url of [t.ogg, t.mp3].filter(Boolean)) {
        try {
          const r = await fetch(url); if (!r.ok) continue;
          const ab = await r.arrayBuffer();
          const buf = await new Promise((ok, no) => { const p = ctx.decodeAudioData(ab, ok, no); if (p && p.then) p.then(ok, no); });
          bufs.set(t, buf); return buf;
        } catch (e) {}   // OGG 解碼失敗（例如 Safari）就改用 MP3
      }
      throw new Error('decode failed');
    }
    async function startWebAudio() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error('no web audio');
        ctx = new AC(); gain = ctx.createGain(); gain.gain.value = vol; gain.connect(ctx.destination);
      }
      const buf = await loadBuf(cur());
      if (src) { try { src.stop(); } catch (e) {} src.disconnect(); }
      src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(gain); src.start();
      if (ctx.state === 'suspended') await ctx.resume();
      mode = 'webaudio';
    }
    function startElement() {
      if (el) { el.pause(); el.remove(); }
      el = document.createElement('audio'); el.loop = true; el.preload = 'auto'; el.volume = vol;
      const t = cur();
      for (const [u, ty] of [[t.ogg, 'audio/ogg'], [t.mp3, 'audio/mpeg']]) if (u) { const so = document.createElement('source'); so.src = u; so.type = ty; el.appendChild(so); }
      mode = 'element';
      return el.play();
    }
    async function start() {   // 從頭播放目前曲目
      if (mode !== 'element') { try { await startWebAudio(); return; } catch (e) { if (ctx && mode === 'webaudio') throw e; } }
      await startElement();
    }
    async function play() {
      busy = true; sync('load');
      try {
        if (mode === 'webaudio' && src) await ctx.resume();
        else if (mode === 'element' && el) await el.play();
        else await start();
        playing = true; ls(KEY, 'on'); sync('on');
      } catch (e) { console.warn('[bgm] 無法播放', e); fail(); }
      busy = false;
    }
    function pause() {
      if (mode === 'webaudio') ctx.suspend(); else if (el) el.pause();
      playing = false; ls(KEY, 'off'); sync('off');
    }
    async function next() {
      if (busy || tracks.length < 2) return;
      idx = (idx + 1) % tracks.length; ls(TKEY, String(all.indexOf(cur())));
      if (!playing) {   // 沒在播：只換曲目，下次按播放就是新歌
        if (mode === 'webaudio' && src) { try { src.stop(); } catch (e) {} src = null; }
        if (mode === 'element' && el) { el.pause(); el.remove(); el = null; }
        return sync('off');
      }
      busy = true; sync('load');
      try { await start(); sync('on'); } catch (e) { console.warn('[bgm] 換歌失敗', e); fail(); }
      busy = false;
    }
    // 檔案存在的曲目才列入；超過一首才顯示「換歌」
    const exists = t => Promise.all([t.ogg, t.mp3].filter(Boolean).map(u => fetch(u, { method: 'HEAD', cache: 'no-store' }).then(r => r.ok).catch(() => false))).then(o => o.some(Boolean));
    Promise.all(all.map(exists)).then(oks => {
      tracks = all.filter((t, i) => oks[i]);
      if (!tracks.length) return fail();
      const saved = all[Number(ls(TKEY))]; idx = Math.max(0, tracks.indexOf(saved));
      btn.hidden = false; credit.hidden = false;
      if (nextBtn) nextBtn.hidden = tracks.length < 2;
      sync(ls(KEY) === 'on' ? 'hint' : 'off');   // 上次有開也不自動播放，只提示
    });
    return { toggle() { if (busy) return; playing ? pause() : play(); }, next, state: () => ({ playing, idx, count: tracks.length, title: tracks[idx] && tracks[idx].title, mode }) };
  })();


  // ---------- 啟動 ----------
  // 頁首高度 → CSS 變數（地圖大小與側欄 sticky 位置用）
  const hdr = $('#top');
  const setHdr = () => document.documentElement.style.setProperty('--hdr', hdr.offsetHeight + 'px');
  new ResizeObserver(setHdr).observe(hdr); setHdr();
  buildCards();
  O.init($('#office'));
  renderDetail();
  loadChat();
  loadAll();
  // 分頁在背景時暫停輪詢與動畫，回到前景時立刻更新一次
  setInterval(() => { if (!document.hidden) loadChat(); }, (C.chatPollSec || 30) * 1000);
  setInterval(() => { if (!document.hidden) loadAll(); }, (C.usagePollSec || 60) * 1000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    O.setActive(!document.hidden);
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt > 20000) { loadChat(); loadAll(); }
    tickStatus(true);
  });
  setInterval(() => tickStatus(false), 400);
  setInterval(() => { if (!document.hidden && Replay.idx < 0 && lastBundle) { renderStamps(lastBundle, lastBuilt); } }, 30000);

  // 對外 API（唯讀；網站不接受任何輸入、不呼叫 AI API）
  window.AIOffice = {
    config: C, office: O, director: D, pools: () => lastBuilt, live: Live, bgm: Bgm,
    select: O.select, say: O.say, setState: O.setState, reload: loadAll, reloadChat: loadChat,
    replay: { go: goReplay, live: goLive, state: () => ({ idx: Replay.idx, count: snapshots().length }) }, setTab,
  };
})();
