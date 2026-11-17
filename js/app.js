/* UI：額度卡片、Agent 列表、全員群聊、詳細資訊 popover、工具列 */
(function () {
  const C = window.OFFICE_CONFIG, O = window.Office, S = window.OfficeSprites;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;
  const cfgById = Object.fromEntries(C.agents.map(a => [a.id, a]));
  const ASSETS = C.assets || {};

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
  function fmtLeft(iso) {
    const d = new Date(iso) - Date.now(); if (!iso || isNaN(d)) return '';
    if (d <= 0) return '已到重置時間';
    const m = Math.round(d / 60000), h = Math.floor(m / 60), day = Math.floor(h / 24);
    return day ? `還有 ${day} 天 ${h % 24} 小時` : h ? `還有 ${h} 小時 ${m % 60} 分` : `還有 ${m} 分`;
  }
  const fmtNum = n => n == null ? '∞' : Math.abs(n) >= 10000 ? (n / 1000).toFixed(0) + 'k' : (Math.round(n * 10) / 10).toLocaleString('zh-TW');
  const WIN = { '5h': '5 小時', daily: '每日', weekly: '每週', monthly: '每月' };

  // ---------- 共用額度資料 ----------
  function validate(j) {
    const out = { schema_version: j && j.schema_version || 1, is_demo: j ? j.is_demo !== false : true, generated_at: j && j.generated_at, note: j && j.note, entries: [] };
    for (const e of (j && Array.isArray(j.entries) ? j.entries : [])) {
      const ok = e && typeof e.agent_id === 'string' && typeof e.provider === 'string' && typeof e.used === 'number' && (e.limit === null || typeof e.limit === 'number') && 'reset_at' in e && typeof e.updated_at === 'string';
      if (ok) out.entries.push(e); else console.warn('[usage] 略過格式不符的資料', e);
    }
    return out;
  }
  const Usage = {
    data: null, source: '', error: '',
    async load() {
      try {
        const r = await fetch(C.usageUrl + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.data = validate(await r.json()); this.source = 'file'; this.error = '';
        this.loadedAt = new Date();
      } catch (e) {
        this.error = String(e.message || e);
        // 讀取失敗時保留上一次成功的真實資料，只有從沒讀到過才退回內建示範資料
        if (this.source !== 'file') { this.data = validate(window.OFFICE_DEMO_USAGE); this.source = 'builtin'; this.loadedAt = new Date(); }
      }
      renderUsage();
    },
    all() { return this.data; },
    get(id) { return (this.data && this.data.entries || []).filter(e => e.agent_id === id); },
  };

  function pct(e) { return e.limit ? Math.max(0, Math.min(100, e.used / e.limit * 100)) : 0; }
  function barColor(p) { return p >= 85 ? '#ff5f57' : p >= 60 ? '#f5a623' : '#4cd964'; }
  function teamEntry() { return (Usage.data && Usage.data.entries || []).find(e => e.agent_id === 'team'); }
  function realRowHTML(e, detailed) {
    if (e.scope === 'own') {
      // Hank 的 Codex 方案只有一個額度：顯示剩餘 % 與重置時間；資料過期或沒回報時不顯示數字
      const state = window.CodexState.state(e);
      if (state === 'unavailable') return '';   // 沒回報的空格子不顯示（Hank 的方案只有一個額度）
      if (state !== 'fresh') {
        return `<div class="u-row nc"><div class="u-label"><span>OpenAI 額度</span><span class="tag-stale">${state === 'stale' ? '資料過期' : '尚未回報'}</span></div>
          <div class="u-meta">${state === 'stale' ? '等小沼王下次回報' : 'Codex 尚未回報額度'}</div></div>`;
      }
      const left = Math.max(0, Math.min(100, 100 - e.used));
      return `<div class="u-row">
        <div class="u-label"><span>OpenAI 額度</span><span class="u-pct">剩餘 ${fmtNum(left)}%</span></div>
        <div class="bar"><i style="width:${left}%;background:${barColor(e.used)}"></i></div>
        ${e.reset_at ? `<div class="u-meta">重置 ${fmtDate(e.reset_at)}（${fmtLeft(e.reset_at)}）</div>` : ''}
      </div>`;
    }
    if (e.connected === false || e.status === 'not_connected') {
      return `<div class="u-row nc"><div class="u-label"><span>${esc(e.provider)}</span><span class="tag-nc">尚未接上</span></div>
        <div class="u-meta">${detailed ? esc(e.note || '尚未接上額度回報') : '額度尚未接上'}</div></div>`;
    }
    if (e.scope === 'own' && (e.reported === false || typeof e.limit !== 'number')) {
      return `<div class="u-row nc"><div class="u-label"><span>${esc(WIN[e.window] || e.window || '')}</span><span class="tag-nc">尚未回報</span></div>
        <div class="u-meta">${detailed ? esc(e.note || 'Codex 尚未回報這個時段的額度') : 'Codex 尚未回報'}</div></div>`;
    }
    if (e.scope === 'own') {
      const p = 100 - e.used;
      return `<div class="u-row">
        <div class="u-label"><span>${esc(WIN[e.window] || ({primary: '主要額度', secondary: '次要額度'})[e.window] || e.window || '')}</span><span class="u-pct">剩餘 ${fmtNum(p)}%</span></div>
        <div class="bar"><i style="width:${p}%;background:${barColor(e.used)}"></i></div>
        <div class="u-meta">重置 ${fmtDate(e.reset_at)}${detailed && e.reset_at ? `（${fmtLeft(e.reset_at)}）` : ''}</div>
      </div>`;
    }
    const share = typeof e.share_pct === 'number' ? e.share_pct : 0;
    const label = e.share_label && String(e.share_label).startsWith('<') ? esc(e.share_label) + '%' : fmtNum(share) + '%';
    return `<div class="u-row">
        <div class="u-label"><span>佔全隊用量</span><span class="u-pct">${label}</span></div>
        <div class="bar"><i style="width:${Math.min(100, share)}%;background:${e.color || '#6fb7e8'}"></i></div>
        <div class="u-meta">≈ 團隊每週額度的 ${fmtNum(e.used)}%${detailed ? `<br>重置 ${fmtDate(e.reset_at)}（${fmtLeft(e.reset_at)}）<br>更新 ${fmtDate(e.updated_at)} · by ${esc(e.updated_by || '—')}` : ''}</div>
      </div>`;
  }
  function usageHTML(id, detailed) {
    const list = Usage.get(id);
    if (!list.length) return '<div class="u-empty">尚無額度資料</div>';
    const demo = Usage.data.is_demo;
    if (demo && id === 'codex-xiao-zhaowang') return '<div class="u-empty">Codex 未連線</div>';
    if (!demo) {
      const own = list.filter(e => e.scope === 'own' && e.connected !== false);
      let head = '';
      if (own.length) {
        const e0 = own[0], age = Date.now() - new Date(e0.updated_at);
        const stale = own.some(e => e.stale) || e0.updated_at_unknown || isNaN(age) || age > 24 * 3600e3;
        head = `<div class="u-own"><span class="tag-own">OpenAI 獨立額度</span>${e0.plan ? `<span class="muted">${esc(e0.plan)}</span>` : ''}${stale ? '<span class="tag-stale">資料過舊</span>' : ''}</div>` +
          (detailed ? `<div class="u-meta">Codex 回報於 ${fmtDate(e0.updated_at)} · 不算在團隊額度內</div>` : '');
      }
      return head + list.map(e => realRowHTML(Object.assign({ color: cfgById[id] && cfgById[id].color }, e), detailed)).join('');
    }
    return list.map(e => {
      const p = pct(e), demoTag = (demo || e.is_demo) ? '<span class="tag-demo">示範</span>' : '';
      return `<div class="u-row">
        <div class="u-label"><span>${esc(e.provider)} · ${esc(WIN[e.window] || e.window || '')}</span>${demoTag}<span class="u-pct">${e.limit ? Math.round(p) + '%' : ''}</span></div>
        <div class="bar"><i style="width:${p}%;background:${barColor(p)}"></i></div>
        <div class="u-meta">${e.unit === '%' && e.limit === 100 ? '已用 ' + fmtNum(e.used) + '%' : fmtNum(e.used) + ' / ' + fmtNum(e.limit) + ' ' + esc(e.unit || '')} · 重置 ${fmtDate(e.reset_at)}${detailed ? `（${fmtLeft(e.reset_at)}）<br>更新 ${fmtDate(e.updated_at)} · by ${esc(e.updated_by || '—')}` : ''}</div>
      </div>`;
    }).join('');
  }
  const ageH = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? (Date.now() - t) / 3600e3 : Infinity; };
  const isStale = iso => ageH(iso) > (C.staleHours || 5);
  function fmtAge(iso) {
    const h = ageH(iso); if (!Number.isFinite(h)) return '時間不明';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分鐘前`;
    if (h < 48) return `${Math.round(h)} 小時前`;
    return `${Math.round(h / 24)} 天前`;
  }
  function renderTeam() {
    const box = $('#teamUsage'), t = teamEntry();
    if (!t || Usage.data.is_demo) { box.hidden = true; return; }
    const p = pct(t);
    const ranked = C.agents.map(a => ({ a, e: Usage.get(a.id)[0] })).filter(x => x.e && x.e.connected !== false && x.e.share_pct > 0).sort((x, y) => y.e.share_pct - x.e.share_pct);
    box.hidden = false;
    box.innerHTML = `
      <div class="t-head"><b>團隊每週額度</b><span class="muted">${esc(t.provider)} · 全員共用</span>${isStale(t.updated_at) ? '<span class="tag-stale">資料較舊</span>' : ''}<span class="t-pct" aria-label="已用 ${fmtNum(t.used)}%">${fmtNum(t.used)}%</span></div>
      <div class="bar big" role="progressbar" aria-label="團隊每週額度已用" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}"><i style="width:${p}%;background:${barColor(p)}"></i></div>
      <div class="u-meta">已用 ${fmtNum(t.used)}% · 重置 ${fmtDate(t.reset_at)}（台北時間，${fmtLeft(t.reset_at)}）· 更新 ${fmtDate(t.updated_at)}</div>
      <div class="stack" title="各 Agent 佔團隊用量">${ranked.map(x => `<i style="width:${x.e.share_pct}%;background:${x.a.color}" title="${esc(x.a.name)} ${x.e.share_pct}%"></i>`).join('')}</div>
      <div class="legend">${ranked.map(x => `<span><i style="background:${x.a.color}"></i>${esc(x.a.short)} ${x.e.share_label && String(x.e.share_label).startsWith('<') ? esc(x.e.share_label) : fmtNum(x.e.share_pct)}%</span>`).join('')}</div>`;
  }
  function renderUsage() {
    for (const a of C.agents) { const el = document.querySelector(`.card[data-id="${a.id}"] .usage`); if (el) el.innerHTML = usageHTML(a.id); }
    renderTeam();
    const t = teamEntry(), upd = (t && t.updated_at) || Usage.data.generated_at;
    const live = Usage.source === 'file' && !Usage.data.is_demo;
    const ds = $('#dataSrc');
    ds.innerHTML = Usage.source !== 'file' ? '<i class="dot-s warn"></i>讀不到額度資料，暫時顯示示範資料'
      : `<i class="dot-s ${Usage.error ? 'warn' : isStale(upd) ? 'old' : 'ok'}"></i>${live ? '真實用量' : '示範資料'} · 更新於 ${fmtAge(upd)}${Usage.error ? ' · 連線中斷' : ''}`;
    ds.title = `額度來源：${C.usageUrl}${Usage.error ? '\n最近一次讀取失敗：' + Usage.error : ''}`;
    $('#usageUpdated').textContent = `讀取於 ${fmtT.format(Usage.loadedAt)}（台北時間）`;
    const al = $('#usageAlert'), msgs = [];
    if (Usage.error && Usage.source === 'file') msgs.push(`⚠️ 最近一次讀取額度失敗（${esc(Usage.error)}），先顯示 ${fmtT.format(Usage.loadedAt)} 讀到的資料，會自動重試。`);
    else if (Usage.source !== 'file') msgs.push('⚠️ 讀不到 usage.json，下方是內建示範數字，不是真實用量。');
    if (live && isStale(upd)) msgs.push(`⏳ 團隊額度 ${fmtAge(upd)}更新，同步排程可能延遲，數字僅供參考。`);
    al.hidden = !msgs.length; al.innerHTML = msgs.join('<br>');
    $('#usageBadge').hidden = !Usage.data.is_demo;
    $('#usageLive').hidden = !!Usage.data.is_demo;
    if (openId) renderPopover();
  }

  // ---------- 卡片 & 列表 ----------
  function buildCards() {
    $('#cards').innerHTML = C.agents.map(a => `
      <button class="card" data-id="${a.id}" style="--c:${a.color}">
        ${avatarImg(a, 4, 'av')}
        <div class="card-main">
          <div class="card-top"><b>${esc(a.name)}</b><span class="status"><i></i><em></em></span></div>
          <div class="role">${esc(a.role)} · ${esc(C.zones[a.zone])}</div>
          <div class="usage"></div>
        </div>
      </button>`).join('');
    $('#agentList').innerHTML = `<li class="al-item group" data-group="1" role="button" tabindex="0"><span class="al-group">群</span><div><b>全員群聊</b><small>${C.agents.length} 位成員 · 真實對話</small></div></li>` +
      C.agents.map(a => `<li class="al-item" data-id="${a.id}" role="button" tabindex="0" aria-label="${esc(a.name)}，${esc(a.role)}">${avatarImg(a, 2)}<div><b>${esc(a.name)}</b><small>${esc(a.role)}</small></div><span class="dot" aria-hidden="true"></span></li>`).join('');
    $('#cards').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) pick(c.dataset.id, c); });
    const onItem = e => {
      const li = e.target.closest('.al-item'); if (!li) return;
      if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); }
      if (li.dataset.group) { toChat(); return; }
      pick(li.dataset.id, li);
    };
    $('#agentList').addEventListener('click', onItem);
    $('#agentList').addEventListener('keydown', onItem);
    $('#agentCount').textContent = `Agents: ${C.agents.length}`;
    if (ASSETS.artCredit) { const ac = $('#artCredit'); ac.hidden = false; ac.textContent = ` · 角色美術：${ASSETS.artCredit}`; }
  }
  // 從卡片/列表選角色：popover 不在畫面上時捲過去讓它看得到；鍵盤操作時把焦點移到 popover
  let returnFocus = null;
  function pick(id, from) {
    const was = O.getSelected() === id;
    O.select(was ? null : id);
    if (was) return;
    returnFocus = from || null;
    if (!isNarrow()) requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = pop.getBoundingClientRect();
      if (r.top < 56 || r.bottom > window.innerHeight) pop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
    if (from && from.matches(':focus-visible')) { const c = pop.querySelector('.pv-close'); if (c) c.focus({ preventScroll: true }); }
  }
  const lastSt = {};
  function tickStatus() {
    if (document.hidden) return;
    for (const a of O.agents) {
      const st = O.statusOf(a), sig = st.label + (O.getSelected() === a.id);
      if (lastSt[a.id] === sig && !(openId === a.id)) continue;
      lastSt[a.id] = sig;
      const card = document.querySelector(`.card[data-id="${a.id}"]`);
      if (card) { card.querySelector('.status em').textContent = st.label; card.querySelector('.status i').style.background = st.color; card.classList.toggle('sel', O.getSelected() === a.id); }
      const li = document.querySelector(`.al-item[data-id="${a.id}"]`);
      if (li) { li.querySelector('.dot').style.background = st.color; li.querySelector('.dot').title = st.label; li.classList.toggle('sel', O.getSelected() === a.id); }
    }
    if (openId) { const a = O.byId[openId], st = O.statusOf(a); const el = $('#pvStatus'); if (el) el.innerHTML = `<i style="background:${st.color}"></i>${st.label} · ${esc(O.activityOf(a))}`; }
  }

  // ---------- Popover ----------
  let openId = null;
  const pop = $('#popover');
  function renderPopover() {
    const a = cfgById[openId]; if (!a) return;
    pop.innerHTML = `
      <div class="pv-head" style="--c:${a.color}">
        ${avatarImg(a, 4)}
        <div><b id="pvName">${esc(a.name)}</b><div class="pv-role">${esc(a.role)}</div><div class="pv-zone">座位：${esc(C.zones[a.zone])}</div></div>
        <button type="button" class="pv-close" aria-label="關閉詳細資訊">✕</button>
      </div>
      ${ASSETS.portraits && ASSETS.portraits[a.id] ? `<img class="pv-portrait" src="${esc(ASSETS.portraits[a.id])}" alt="${esc(a.name)} 角色立繪" data-optional="1" loading="lazy" decoding="async">` : ''}
      <div class="pv-status" id="pvStatus" aria-live="off"></div>
      <p class="pv-intro">${esc(a.intro)}</p>
      <div class="pv-sec">額度 ${Usage.data && Usage.data.is_demo ? '<span class="tag-demo">示範資料</span>' : '<span class="tag-live">真實用量</span>'}</div>
      <div class="pv-usage">${usageHTML(a.id, true)}</div>
      <div class="pv-actions">
        <button type="button" data-pv="chat">💬 看群聊</button>
        <button type="button" data-pv="working">💻 回座工作</button>
        <button type="button" data-pv="meeting">📋 去開會</button>
        <button type="button" data-pv="idle">☕ 去休息</button>
      </div>`;
    tickStatus();
  }
  function positionPopover() {
    if (!openId || pop.hidden) return;
    if (isNarrow()) { pop.style.left = pop.style.top = ''; return; }
    const p = O.screenPos(openId), wrap = $('#mapWrap'); if (!p) return;
    const pw = pop.offsetWidth, ph = pop.offsetHeight, W = wrap.clientWidth, H = wrap.clientHeight;
    const cv = $('#office'); p.x += cv.offsetLeft; p.y += cv.offsetTop;
    let x = p.x + 24; if (x + pw > W - 6) x = p.x - pw - 24;
    let y = p.y - ph / 2; y = Math.max(6, Math.min(H - ph - 6, y));
    pop.style.left = Math.max(6, x) + 'px'; pop.style.top = y + 'px';
  }
  O.onSelect(id => {
    openId = id;
    if (!id) {
      pop.hidden = true; tickStatus();
      if (returnFocus && pop.contains(document.activeElement)) returnFocus.focus({ preventScroll: true });
      returnFocus = null; return;
    }
    pop.hidden = false; renderPopover(); positionPopover();
  });
  O.onFrame(positionPopover);
  pop.addEventListener('click', e => {
    if (e.target.closest('.pv-close')) return O.select(null);
    const b = e.target.closest('[data-pv]'); if (!b) return;
    const act = b.dataset.pv;
    if (act === 'chat') { O.select(null); toChat(); }
    else O.setState(openId, act, act === 'working' ? 30 : 20);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') O.select(null); });

  // ---------- 全員群聊（真實紀錄，唯讀） ----------
  // Hank 在 Grok Bot 發話，澳洲企鵝把夥伴的真實回覆寫進 data/chat.json；這裡只負責顯示。
  const log = $('#chatLog');
  const chatUrl = C.chatUrl || 'data/chat.json';
  const LONG = 400;
  const Chat = { data: null, sig: '', seen: null, expanded: new Set(), error: '' };
  const fmtMsgT = iso => { const d = new Date(iso); return isNaN(d) ? '' : fmtDT.format(d); };
  const textHTML = t => esc(t).replace(/\n/g, '<br>');
  function bubbleHTML(key, text) {
    const t = String(text || '');
    if (t.length <= LONG) return `<div class="bubble">${textHTML(t)}</div>`;
    const open = Chat.expanded.has(key);
    return `<div class="bubble long${open ? ' open' : ''}" data-key="${esc(key)}">${textHTML(t)}</div><button class="more" data-key="${esc(key)}">${open ? '收合' : '展開全文'}（${t.length} 字）</button>`;
  }
  function unknownAvatar(name) {
    return `<span class="av-unk">${esc((name || '?').trim().charAt(0) || '?')}</span>`;
  }
  function msgHTML(m, key) {
    const at = m.at ? `<span class="at">${fmtMsgT(m.at)}</span>` : '';
    if (m.from === 'system') return `<div class="msg system"><div class="note sys">${textHTML(m.text)} ${at}</div></div>`;
    if (m.from === 'user') return `<div class="msg user"><div class="who">Hank ${at}</div>${bubbleHTML(key, m.text)}</div>`;
    const a = cfgById[m.from];
    const name = a ? a.name : (m.name || m.from || '未知夥伴');
    const color = a ? a.color : '#8a93b8';
    const img = a ? avatarImg(a, 2) : unknownAvatar(name);
    return `<div class="msg agent" style="--c:${color}">${img}<div class="m-body"><div class="who">${esc(name)} ${at}</div>${bubbleHTML(key, m.text)}</div></div>`;
  }
  function roundHTML(r, i) {
    const n = /^r(\d+)$/.test(r.id || '') ? r.id.slice(1) : i + 1;
    const msgs = Array.isArray(r.messages) ? r.messages : [];
    let h = `<div class="msg system"><div class="round">第 ${esc(n)} 輪 · ${esc(r.title || '群聊')} <span class="tag-live">真實</span>${r.started_at ? ` <span class="at">${fmtMsgT(r.started_at)}</span>` : ''}</div></div>`;
    h += msgs.map((m, j) => msgHTML(m || {}, `${r.id}:${j}`)).join('');
    const ids = [...new Set(msgs.map(m => m && m.from).filter(f => f && f !== 'user' && f !== 'system'))];
    if (r.done) {
      if (ids.length) h += `<div class="msg system"><div class="done">✓ 討論完成<div class="chips">${ids.map(id => `<span>✓ ${esc(cfgById[id] ? cfgById[id].short : id)} 已回覆</span>`).join('')}</div></div></div>`;
    } else h += `<div class="msg system"><div class="typing">夥伴回覆中…（每 30 秒自動更新）</div></div>`;
    return h;
  }
  function renderChat() {
    const rounds = Chat.data && Array.isArray(Chat.data.rounds) ? Chat.data.rounds : [];
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const prevTop = log.scrollTop;
    const talked = rounds.some(r => (r.messages || []).some(m => m && m.from !== 'system'));
    const howto = `<div class="chat-howto"><b>💡 群聊怎麼運作</b><ol><li>Hank 在 Grok Bot 說「群聊：…」（全員）或「@名字 …」（指定夥伴）</li><li>澳洲企鵝把話轉給夥伴，收集他們的<b>真實回覆</b></li><li>回覆會整理成一輪對話，自動顯示在這裡，角色頭上也會冒出對話泡泡</li></ol><small>目前還沒有夥伴的真實回覆，第一輪群聊開始後就會出現。</small></div>`;
    if (!rounds.length) log.innerHTML = `<div class="chat-empty">還沒有對話</div>` + howto;
    else log.innerHTML = rounds.map(roundHTML).join('') + (talked ? '' : howto);
    const ca = $('#chatAlert');
    ca.hidden = !Chat.error;
    ca.textContent = Chat.error ? `⚠️ 讀取群聊失敗（${Chat.error}），${Chat.data ? '先顯示上次的紀錄，' : ''}會自動重試。` : '';
    if (atBottom || !Chat.rendered) log.scrollTop = log.scrollHeight; else log.scrollTop = prevTop;
    Chat.rendered = true;
    const upd = Chat.data && Chat.data.updated_at;
    $('#chatUpdated').textContent = upd ? `更新 ${fmtMsgT(upd)}` : '';
  }
  async function loadChat() {
    try {
      const r = await fetch(chatUrl + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !Array.isArray(j.rounds)) throw new Error('格式不符');
      const hadErr = !!Chat.error; Chat.error = '';
      const sig = JSON.stringify(j);
      if (sig === Chat.sig && Chat.rendered) { if (hadErr) renderChat(); return; }
      const first = Chat.seen === null, seen = new Set();
      const fresh = [];
      for (const rd of j.rounds) (rd.messages || []).forEach((m, k) => {
        const key = `${rd.id}:${k}`; seen.add(key);
        if (!first && !Chat.seen.has(key) && m && cfgById[m.from]) fresh.push(m);
      });
      Chat.data = j; Chat.sig = sig; Chat.seen = seen;
      renderChat();
      // 新訊息：在角色頭上冒出對話泡泡
      fresh.forEach((m, i) => setTimeout(() => {
        const t = String(m.text).replace(/\s+/g, ' ');
        O.say(m.from, t.length > 12 ? t.slice(0, 12) + '…' : t, 5000);
      }, i * 1800));
    } catch (e) {
      Chat.error = String(e.message || e);
      renderChat();
    }
  }
  log.addEventListener('click', e => {
    const b = e.target.closest('button.more'); if (!b) return;
    const k = b.dataset.key, open = !Chat.expanded.has(k);
    open ? Chat.expanded.add(k) : Chat.expanded.delete(k);
    const bub = b.previousElementSibling; bub.classList.toggle('open', open);
    b.textContent = `${open ? '收合' : '展開全文'}（${bub.textContent.length} 字）`;
    b.setAttribute('aria-expanded', String(open));
  });
  const toChat = () => { $('.chat').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); log.focus({ preventScroll: true }); };

  // ---------- 工具列 ----------
  $('.tools').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    switch (b.dataset.act) {
      case 'meeting': O.setAll('meeting', 25); break;
      case 'work': O.setAll('working', 30); break;
      case 'break': O.setAll('idle', 20); break;
      case 'pause': { const p = O.togglePause(); setBtn(b, p ? '▶' : '⏸', p ? '繼續' : '暫停', p); break; }
      case 'labels': { const on = O.toggleLabels(); b.classList.toggle('off', !on); b.setAttribute('aria-pressed', String(on)); break; }
      case 'reload': b.classList.add('spin'); Promise.all([Usage.load(), loadChat()]).finally(() => setTimeout(() => b.classList.remove('spin'), 300)); break;
      case 'zoom': { const z = $('#mapWrap').classList.toggle('zoomed'); setBtn(b, '🔍', z ? '符合寬度' : '放大地圖', z); break; }
      case 'bgm': Bgm.toggle(); break;
    }
  });

  function setBtn(b, icon, label, pressed) { b.innerHTML = `${icon} <span>${label}</span>`; b.setAttribute('aria-pressed', String(!!pressed)); }

  // ---------- 背景音樂：預設靜音，使用者按了才播放；用 Web Audio 無縫循環 ----------
  const Bgm = (() => {
    const cfg = ASSETS.bgm, btn = $('#bgmBtn'), credit = $('#bgmCredit'), KEY = 'aiOffice.bgm';
    if (!cfg || !(cfg.ogg || cfg.mp3)) return { toggle() {} };
    const vol = cfg.volume || 0.5;
    const pref = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
    const save = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
    let mode = null, ctx = null, el = null, playing = false, busy = false;
    const sync = (state) => {
      const map = { on: ['🔊', '音樂播放中'], off: ['🔇', '背景音樂'], load: ['⏳', '載入音樂…'], hint: ['🎵', '點我播音樂'] };
      const [ic, lb] = map[state]; setBtn(btn, ic, lb, state === 'on');
      btn.classList.toggle('hint', state === 'hint');
      btn.title = `《${cfg.title}》· 作曲：${cfg.credit}` + (state === 'on' ? '（再按一次靜音）' : '（按一下播放，預設靜音）');
    };
    const fail = () => { playing = false; busy = false; btn.hidden = true; credit.hidden = true; };
    async function startWebAudio() {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error('no web audio');
      ctx = new AC();
      let buf = null;
      for (const url of [cfg.ogg, cfg.mp3].filter(Boolean)) {
        try {
          const r = await fetch(url); if (!r.ok) continue;
          const ab = await r.arrayBuffer();
          buf = await new Promise((ok, no) => { const p = ctx.decodeAudioData(ab, ok, no); if (p && p.then) p.then(ok, no); });
          break;
        } catch (e) { buf = null; }   // OGG 解碼失敗（例如 Safari）就改用 MP3
      }
      if (!buf) { ctx.close(); ctx = null; throw new Error('decode failed'); }
      const gain = ctx.createGain(); gain.gain.value = vol; gain.connect(ctx.destination);
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(gain); src.start();
      mode = 'webaudio';
    }
    function startElement() {
      el = document.createElement('audio'); el.loop = true; el.preload = 'auto'; el.volume = vol;
      for (const [u, t] of [[cfg.ogg, 'audio/ogg'], [cfg.mp3, 'audio/mpeg']]) if (u) { const so = document.createElement('source'); so.src = u; so.type = t; el.appendChild(so); }
      mode = 'element';
      return el.play();
    }
    async function play() {
      busy = true; sync('load');
      try {
        if (mode === 'webaudio') await ctx.resume();
        else if (mode === 'element') await el.play();
        else { try { await startWebAudio(); } catch (e) { await startElement(); } }
        playing = true; save('on'); sync('on');
      } catch (e) { console.warn('[bgm] 無法播放', e); fail(); }
      busy = false;
    }
    function pause() {
      if (mode === 'webaudio') ctx.suspend(); else if (el) el.pause();
      playing = false; save('off'); sync('off');
    }
    // 檔案存在才顯示按鈕與作者
    Promise.all([cfg.ogg, cfg.mp3].filter(Boolean).map(u => fetch(u, { method: 'HEAD', cache: 'no-store' }).then(r => r.ok).catch(() => false)))
      .then(oks => {
        if (!oks.some(Boolean)) return fail();
        btn.hidden = false; credit.hidden = false;
        credit.textContent = ` · 背景音樂《${cfg.title}》作曲：${cfg.credit}`;
        sync(pref() === 'on' ? 'hint' : 'off');   // 上次有開也不自動播放，只提示
      });
    return { toggle() { if (busy) return; playing ? pause() : play(); } };
  })();

  // ---------- 啟動 ----------
  buildCards();
  O.init($('#office'));
  loadChat();
  Usage.load();
  // 分頁在背景時暫停輪詢與動畫，回到前景時立刻更新一次
  setInterval(() => { if (!document.hidden) loadChat(); }, (C.chatPollSec || 30) * 1000);
  setInterval(() => { if (!document.hidden) Usage.load(); }, (C.usagePollSec || 60) * 1000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    O.setActive(!document.hidden);
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt > 20000) { loadChat(); Usage.load(); }
    tickStatus();
  });
  setInterval(tickStatus, 400); tickStatus();

  // 對外 API：之後接真實 Agent / 額度用
  window.AIOffice = {
    config: C, office: O, usage: Usage,
    select: O.select, say: O.say, setState: O.setState,
    chat: Chat, reloadChat: loadChat,
  };
})();
