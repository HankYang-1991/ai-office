/* 休息區街機選單：列出已註冊的小遊戲與各遊戲目前的第一名。純前端，不呼叫 API。 */
(function () {
  'use strict';
  const games = [];
  let modal, cards, opener = null, open = false;
  const byId = () => Object.fromEntries(games.map(g => [g.id, g]));

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

  function renderCards() {
    if (!cards) return;
    const B = window.ArcadeBoard;
    cards.innerHTML = '';
    games.forEach(g => {
      const top = B && B.best(g.id);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'arcade-card'; b.dataset.game = g.id;
      b.innerHTML = `<span class="ac-emoji">${g.emoji || '🎮'}</span><span class="ac-body"><b>${g.title}</b><small>${g.blurb || ''}</small><span class="ac-best">${top ? `🥇 ${top.score.toLocaleString('en-US')} · ${top.name}` : '尚無紀錄'}</span></span><span class="ac-go">玩</span>`;
      b.addEventListener('click', () => play(g.id));
      cards.appendChild(b);
    });
  }

  function closeGames() { games.forEach(g => { if (g.isOpen && g.isOpen() && g.close) g.close({ silent: true }); }); }

  function openMenu(from) {
    if (!modal) return;
    closeGames();
    opener = from && from.focus ? from : document.getElementById('gameBtn') || document.activeElement;
    open = true; modal.hidden = false; document.body.classList.add('qj-open');
    renderCards();
    if (window.Office) window.Office.setActive(false);
    const first = modal.querySelector('.arcade-card') || modal.querySelector('#arcadeName');
    setTimeout(() => { if (open && first) first.focus({ preventScroll: true }); }, 30);
  }
  function closeMenu() {
    if (!open) return;
    open = false; modal.hidden = true;
    if (!anyGameOpen()) document.body.classList.remove('qj-open');
    if (window.Office) window.Office.setActive(!document.hidden && !anyGameOpen());
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  }
  function play(id) {
    const g = byId()[id]; if (!g || !g.open) return;
    if (open) { open = false; modal.hidden = true; }
    document.body.classList.add('qj-open');
    if (window.Office) window.Office.setActive(false);
    g.open({ fromMenu: true, opener: document.getElementById('gameBtn') });
  }
  // 遊戲視窗關閉時回到選單（silent 關閉則不再打開選單，給整組關掉用）
  function gameClosed(opts) {
    if (opts && opts.silent) return;
    if (!modal) return;
    open = true; modal.hidden = false; document.body.classList.add('qj-open');
    renderCards();
    const btn = modal.querySelector('.arcade-card') || modal.querySelector('#arcadeMenuClose');
    if (btn) btn.focus({ preventScroll: true });
    if (window.Office) window.Office.setActive(false);
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); }
  }

  function init() {
    modal = document.getElementById('arcadeModal'); if (!modal) return;
    cards = document.getElementById('arcadeCards');
    const closeBtn = document.getElementById('arcadeMenuClose');
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    modal.addEventListener('pointerdown', e => { if (e.target === modal && e.pointerType === 'mouse') closeMenu(); });
    if (window.ArcadeBoard) window.ArcadeBoard.bindNameInput(document.getElementById('arcadeName'));
    document.addEventListener('keydown', onKey, true);
  }

  window.Arcade = {
    register, openMenu, closeMenu, play, gameClosed, isBusy, isMenuOpen: () => open,
    games: () => games.slice(), CHARS,
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
