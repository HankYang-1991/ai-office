/* 休息區街機外殼：三個等寬分頁直接開遊戲。純前端，不呼叫 API。 */
(function () {
  'use strict';
  const KEY_LAST = 'aiOffice.arcadeLastGame';
  const ORDER = ['jump', 'catch', 'dash'];
  const PANE = { jump: 'qjPane', catch: 'ccPane', dash: 'hdPane' };
  const games = [];
  let modal, panel, opener = null, open = false, current = null;
  const byId = () => Object.fromEntries(games.map(g => [g.id, g]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無痕或額滿就略過 */ } },
  };

  const CHARS = [
    { id: 'da-zhaowang', name: '大沼王', tag: '漫畫家', color: '#5a9fd6', accent: '#2f6aa0' },
    { id: 'codex-xiao-zhaowang', name: '小沼王', tag: '程式開發', color: '#6fb7e8', accent: '#3d7fb0' },
    { id: 'zhaowang-xiaobao', name: '沼王小寶', tag: '攝影師', color: '#8fd0f0', accent: '#4f9cc8' },
    { id: 'jiantou-xiao-zhaowang', name: '尖頭小沼王', tag: '音樂家', color: '#8cdcd2', accent: '#6cc2b9' },
    { id: 'au-penguin', name: '澳洲企鵝', tag: '隱藏夥伴', color: '#5d6b82', accent: '#e85d4a', bonus: true },
  ];

  function register(g) { if (g && g.id && !byId()[g.id]) games.push(g); }
  function anyGameOpen() { return games.some(g => g.isOpen && g.isOpen()); }
  function isBusy() { return open || anyGameOpen(); }
  function api(id) {
    return ({ jump: window.QuagsireJump, catch: window.CoffeeCatch, dash: window.HallwayDash })[id];
  }

  function deactivate(id) {
    const g = byId()[id];
    if (g && g.isOpen && g.isOpen() && g.close) g.close({ silent: true });
  }

  function paintTabScores() {
    const B = window.ArcadeBoard;
    ORDER.forEach(id => {
      const el = document.getElementById('tabBest-' + id);
      if (!el) return;
      const top = B && B.best(id);
      el.textContent = top ? `🥇 ${top.score.toLocaleString('en-US')}` : '';
    });
  }

  function syncTabs() {
    ORDER.forEach(id => {
      const tab = document.getElementById('tab-' + id);
      const pane = document.getElementById(PANE[id]);
      const on = id === current;
      if (tab) { tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; }
      if (pane) pane.hidden = !on;
    });
    if (panel) panel.classList.toggle('wide', current === 'dash');
    paintTabScores();
    syncMute();
  }

  function switchTo(id) {
    if (!ORDER.includes(id)) id = 'jump';
    if (current && current !== id) deactivate(current);
    current = id;
    store.set(KEY_LAST, id);
    syncTabs();
    const g = byId()[id];
    if (g && g.open && !(g.isOpen && g.isOpen())) g.open({ fromMenu: true, opener: opener || document.getElementById('gameBtn') });
    const tab = document.getElementById('tab-' + id);
    if (tab && document.activeElement && document.activeElement.classList.contains('arcade-tab')) {
      tab.focus({ preventScroll: true });
    }
  }

  function openShell(from, id) {
    if (!modal) return;
    const want = (id && ORDER.includes(id)) ? id : (ORDER.includes(store.get(KEY_LAST, '')) ? store.get(KEY_LAST, 'jump') : 'jump');
    if (open) { if (want !== current) switchTo(want); return; }
    opener = from && from.focus ? from : document.getElementById('gameBtn') || document.activeElement;
    open = true; modal.hidden = false; document.body.classList.add('qj-open');
    if (window.Office) window.Office.setActive(false);
    current = null;
    switchTo(want);
    const tab = document.getElementById('tab-' + current);
    setTimeout(() => { if (open && tab) tab.focus({ preventScroll: true }); }, 30);
  }
  function closeShell() {
    if (!open) return;
    if (current) deactivate(current);
    current = null;
    open = false; modal.hidden = true;
    document.body.classList.remove('qj-open');
    if (window.Office) window.Office.setActive(!document.hidden);
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  }

  function toggleMute() {
    const a = api(current);
    if (a && a.toggleMute) a.toggleMute();
    else syncMute();
  }
  function syncMute() {
    const btn = document.getElementById('arcadeMute');
    if (!btn) return;
    const a = api(current);
    const muted = !!(a && a.isMuted && a.isMuted());
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-pressed', String(!muted));
    btn.title = muted ? '音效：關（按一下開啟）' : '音效：開（按一下關閉）';
  }

  function focusables() {
    if (!modal) return [];
    return [...modal.querySelectorAll('button:not(:disabled), input:not([disabled]), [tabindex="0"]')]
      .filter(el => !el.closest('[hidden]') && el.getClientRects().length);
  }
  function trapFocus(e) {
    const f = focusables();
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1)) {
      e.preventDefault();
      f[e.shiftKey ? f.length - 1 : 0].focus({ preventScroll: true });
    }
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      const typing = e.target && e.target.closest && e.target.closest('input, textarea');
      if (typing) { e.target.blur(); return; }
      closeShell(); return;
    }
    if (e.key === 'Tab') {
      const typing = e.target && e.target.closest && e.target.closest('input, textarea');
      if (typing) return;
      trapFocus(e); return;
    }
    const tab = e.target && e.target.closest && e.target.closest('.arcade-tab');
    if (!tab) return;
    const i = ORDER.indexOf(tab.dataset.game);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = ORDER[(i + (e.key === 'ArrowRight' ? 1 : ORDER.length - 1)) % ORDER.length];
      switchTo(n);
      const next = document.getElementById('tab-' + n);
      if (next) next.focus({ preventScroll: true });
    } else if (e.key === 'Home') { e.preventDefault(); switchTo(ORDER[0]); document.getElementById('tab-' + ORDER[0]).focus({ preventScroll: true }); }
    else if (e.key === 'End') { e.preventDefault(); switchTo(ORDER[ORDER.length - 1]); document.getElementById('tab-' + ORDER[ORDER.length - 1]).focus({ preventScroll: true }); }
  }

  function init() {
    modal = document.getElementById('arcadeModal'); if (!modal) return;
    panel = document.getElementById('arcadePanel');
    const closeBtn = document.getElementById('arcadeMenuClose');
    if (closeBtn) closeBtn.addEventListener('click', closeShell);
    const muteBtn = document.getElementById('arcadeMute');
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);
    modal.querySelectorAll('.arcade-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTo(tab.dataset.game));
    });
    modal.addEventListener('pointerdown', e => { if (e.target === modal && e.pointerType === 'mouse') closeShell(); });
    document.addEventListener('keydown', onKey, true);
    if (window.ArcadeBoard && ArcadeBoard.onName) ArcadeBoard.onName(paintTabScores);
  }

  window.Arcade = {
    register, openMenu: openShell, openShell, closeMenu: closeShell, closeShell,
    play: id => openShell(document.getElementById('gameBtn'), id),
    gameClosed: () => {}, isBusy, isMenuOpen: () => open, isShellOpen: () => open,
    current: () => current, games: () => games.slice(), CHARS, syncMute,
    // 共用：角色走路圖載入（64×64 格）
    loadSheets(chars, sheets) {
      (chars || CHARS).forEach(c => {
        if (sheets[c.id]) return;
        const img = new Image(), rec = { img, pad: 4, ok: false };
        sheets[c.id] = rec;
        img.onload = () => {
          rec.ok = img.naturalWidth >= 192 && img.naturalHeight >= 192;
          try {
            const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
            const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, 64, 64, 0, 0, 64, 64);
            const d = cx.getImageData(0, 0, 64, 64).data;
            for (let y = 63; y >= 0; y--) { let hit = false; for (let x = 0; x < 64; x++) if (d[(y * 64 + x) * 4 + 3] > 40) { hit = true; break; } if (hit) { rec.pad = 63 - y; break; } }
          } catch (e) { /* 讀不到像素就用預設 */ }
        };
        img.onerror = () => { rec.ok = false; };
        img.src = `assets/characters/${c.id}-walk.png`;
      });
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
