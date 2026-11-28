/* 休息區街機共用排行榜與玩家名稱。
 * 只寫本機 localStorage，不呼叫任何 API、不含金鑰。每台裝置各自一份前五名。
 * 會把舊版「沼王跳跳樂」的 aiOffice.quagsireJumpBest 一次遷入 jump 榜。
 */
(function () {
  'use strict';
  const NAME_KEY = 'aiOffice.arcadeName';
  const BOARDS_KEY = 'aiOffice.arcadeBoards';
  const LEGACY_BEST = { jump: 'aiOffice.quagsireJumpBest' };
  const DEFAULT_NAME = '匿名沼王';
  const MAX_LEN = 12, TOP = 5;
  const TZ = 'Asia/Taipei';
  const listeners = [];

  function rawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function rawSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無痕模式略過 */ } }

  function sanitize(s) {
    let t = String(s == null ? '' : s)
      .replace(/[\u0000-\u001F\u007F<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    t = [...t].slice(0, MAX_LEN).join('');
    return t || DEFAULT_NAME;
  }

  function getName() {
    const v = rawGet(NAME_KEY);
    return v == null || v === '' ? DEFAULT_NAME : sanitize(v);
  }
  function setName(s) {
    const n = sanitize(s);
    rawSet(NAME_KEY, n);
    listeners.forEach(fn => { try { fn(n); } catch (e) { /* ignore */ } });
    return n;
  }
  function onName(fn) { listeners.push(fn); }

  function nowISO() {
    const d = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = {}; fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00+08:00`;
  }
  function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[2]}/${m[3]}` : '—';
  }

  function emptyBoards() { return { jump: [], catch: [], dash: [] }; }

  function readAll() {
    let data = emptyBoards();
    try {
      const parsed = JSON.parse(rawGet(BOARDS_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        for (const id of Object.keys(data)) {
          const arr = Array.isArray(parsed[id]) ? parsed[id] : (parsed[id] && parsed[id].entries) || [];
          data[id] = arr.map(normalize).filter(Boolean);
        }
      }
    } catch (e) { /* 損壞就當空的，下面再遷入舊最高分 */ }
    migrateLegacy(data);
    return data;
  }
  function normalize(e) {
    if (!e || typeof e !== 'object') return null;
    const score = Math.max(0, Math.floor(Number(e.score) || 0));
    return {
      id: String(e.id || ('e' + Math.random().toString(36).slice(2, 10))),
      name: sanitize(e.name),
      score,
      floor: Math.max(0, Math.floor(Number(e.floor) || 0)),
      character: String(e.character || '').slice(0, 20),
      at: String(e.at || nowISO()),
    };
  }
  function writeAll(data) { rawSet(BOARDS_KEY, JSON.stringify(data)); }

  let migrated = false;
  function migrateLegacy(data) {
    if (migrated) return;
    migrated = true;
    let changed = false;
    for (const [id, key] of Object.entries(LEGACY_BEST)) {
      if ((data[id] || []).length) continue;
      const n = Math.max(0, parseInt(rawGet(key) || '0', 10) || 0);
      if (n > 0) {
        data[id] = [normalize({ name: getName(), score: n, floor: 0, character: '', at: nowISO() })];
        changed = true;
      }
    }
    if (changed) writeAll(data);
  }

  function sortEntries(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.at).localeCompare(String(b.at));   // 同分時先到者排前面
  }
  function list(gameId) {
    const data = readAll();
    return (data[gameId] || []).slice().sort(sortEntries).slice(0, TOP);
  }
  function best(gameId) { return list(gameId)[0] || null; }
  function bestScore(gameId) { const b = best(gameId); return b ? b.score : 0; }

  function submit(gameId, rec) {
    const data = readAll();
    const entry = normalize({
      id: 'e' + Math.random().toString(36).slice(2, 10),
      name: rec && rec.name != null ? rec.name : getName(),
      score: rec && rec.score,
      floor: rec && rec.floor,
      character: rec && rec.character,
      at: nowISO(),
    });
    const prevBest = bestScore(gameId);
    const all = (data[gameId] || []).concat(entry).sort(sortEntries);
    const rank = all.findIndex(e => e.id === entry.id) + 1;
    const entered = rank > 0 && rank <= TOP && entry.score > 0;
    data[gameId] = all.slice(0, TOP);
    writeAll(data);
    if (LEGACY_BEST[gameId]) rawSet(LEGACY_BEST[gameId], String(Math.max(prevBest, entry.score)));
    return { entry, rank: entered ? rank : 0, entered, newRecord: entry.score > prevBest, list: data[gameId] };
  }

  function rename(gameId, entryId, name) {
    const data = readAll();
    const n = sanitize(name);
    let ok = false;
    (data[gameId] || []).forEach(e => { if (e.id === entryId) { e.name = n; ok = true; } });
    if (ok) writeAll(data);
    return ok;
  }

  function bindNameInput(el) {
    if (!el) return;
    const sync = n => { if (document.activeElement !== el) el.value = n; };
    el.maxLength = MAX_LEN;
    el.placeholder = DEFAULT_NAME;
    el.autocomplete = 'nickname';
    el.spellcheck = false;
    el.value = getName();
    const commit = () => { el.value = setName(el.value); };
    el.addEventListener('change', commit);
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); el.blur(); } });
    onName(sync);
  }

  function render(el, gameId, opts) {
    if (!el) return;
    const o = opts || {}, rows = list(gameId), hi = o.highlightId, extra = o.extra || (n => n.floor ? String(n.floor) : '—');
    if (!rows.length) {
      el.innerHTML = '<p class="arc-empty">還沒有紀錄，來爭一下第一名吧！</p>';
      return;
    }
    el.innerHTML = '<ol class="arc-list">' + rows.map((e, i) => {
      const on = e.id === hi ? ' on' : '';
      return `<li class="arc-row${on}"><b class="arc-rk">${i + 1}</b><span class="arc-nm"></span><span class="arc-sc">${e.score.toLocaleString('en-US')}</span><span class="arc-ex">${extra(e)}</span><span class="arc-who">${e.character || ''}</span><span class="arc-dt">${formatDate(e.at)}</span></li>`;
    }).join('') + '</ol>';
    [...el.querySelectorAll('.arc-nm')].forEach((n, i) => { n.textContent = rows[i].name; });
  }

  window.ArcadeBoard = {
    DEFAULT_NAME, MAX_LEN, TOP, sanitize, getName, setName, onName, bindNameInput,
    list, best, bestScore, submit, rename, formatDate, render,
  };
})();
