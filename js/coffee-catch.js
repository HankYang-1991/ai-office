/* 沼王接咖啡（Quagsire Coffee Catch）：在休息區接住落下的咖啡與星星，躲開蟲子與額度警報。
 * 純前端 Canvas + Web Audio，不呼叫 API。玩法數值由量化分析師（OpenAI gpt-6.2-astra）設計。
 * 邏輯解析度 180×280；名字與前五名走共用的 ArcadeBoard。
 */
(function () {
  'use strict';
  const W = 180, H = 280, CUP_Y = 244, SPEED = 144, IR = 4, DT = 0.05;
  const KEY_CHAR = 'aiOffice.coffeeCatchChar', KEY_MUTE = 'aiOffice.coffeeCatchMute';
  const CHARS = (window.Arcade && Arcade.CHARS) || [];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const waveAt = t => 1 + Math.floor(t / 12);
  const pace = w => w - Number(w >= 2) - Number(w >= 4);   // 新危險物登場那一波先不加速度（OpenAI 建議）
  const interval = w => Math.max(0.58, 1.25 - 0.08 * (pace(w) - 1));
  const fallVy = w => Math.min(148, 58 + 8 * (pace(w) - 1));

  let modal, canvas, ctx, hud = {}, ui = {}, opener = null;
  let k = 2, open = false, rafId = 0, last = 0, ro = null;
  let mode = 'title', g = null, charIdx = clamp(parseInt(store.get(KEY_CHAR, '0'), 10) || 0, 0, Math.max(0, CHARS.length - 1));
  const boardBest = () => (window.ArcadeBoard ? ArcadeBoard.bestScore('catch') : 0);
  let best = 0, lastEntryId = null, fromMenu = false, muted = store.get(KEY_MUTE, '0') === '1';
  const keys = { left: false, right: false };
  const touch = { left: false, right: false };
  const drag = { on: false, x: 0, id: null };
  const sheets = {};

  const Sfx = (() => {
    let ac = null, master = null;
    function ensure() {
      if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return ac; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try { ac = new AC(); master = ac.createGain(); master.gain.value = 0.16; master.connect(ac.destination); } catch (e) { ac = null; }
      return ac;
    }
    function tone(f0, f1, dur, type, vol, delay) {
      if (muted || !ac) return;
      const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), gn = ac.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      ensure,
      catch: kind => { if (kind === 'star') { [1047, 1319, 1568].forEach((f, i) => tone(f, f, 0.07, 'square', 0.28, i * 0.05)); } else tone(880, 1320, 0.1, 'square', 0.3); },
      combo: () => { tone(660, 660, 0.06, 'square', 0.25); tone(990, 990, 0.08, 'square', 0.25, 0.07); },
      miss: () => tone(240, 140, 0.16, 'triangle', 0.3),
      hurt: () => { tone(400, 90, 0.28, 'sawtooth', 0.35); },
      alarm: () => { tone(620, 160, 0.35, 'square', 0.4); tone(620, 160, 0.2, 'square', 0.25, 0.12); },
      wave: () => { tone(784, 784, 0.07, 'triangle', 0.3); tone(1175, 1175, 0.1, 'triangle', 0.3, 0.08); },
      over: () => { [523, 392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.16, 'square', 0.3, 0.08 + i * 0.16)); },
      record: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.1, 'square', 0.28, 0.8 + i * 0.09)); },
      select: () => tone(660, 880, 0.06, 'square', 0.25),
    };
  })();

  function loadSheets() { if (window.Arcade) Arcade.loadSheets(CHARS, sheets); }

  function R(x, y, w, h, c) {
    const x0 = Math.round(x * k), y0 = Math.round(y * k);
    ctx.fillStyle = c; ctx.fillRect(x0, y0, Math.round((x + w) * k) - x0, Math.round((y + h) * k) - y0);
  }
  function text(str, x, y, size, color, align, outline) {
    ctx.font = `700 ${Math.round(size * k)}px ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace`;
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    if (outline) { ctx.lineWidth = Math.max(2, Math.round(k * 1.2)); ctx.strokeStyle = outline; ctx.strokeText(str, Math.round(x * k), Math.round(y * k)); }
    ctx.fillStyle = color; ctx.fillText(str, Math.round(x * k), Math.round(y * k));
  }
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function spawnItem(t, wave, rng) {
    const roll = rng();
    let type = 'coffee';
    if (roll < 0.15) type = 'star';
    else if (roll < 0.35 && wave >= 2) type = 'bug';
    else if (roll >= 0.90 && wave >= 4) type = 'alarm';
    return { type, born: t, x: IR + rng() * (W - 2 * IR), y: -IR, vy: fallVy(wave), passed: false, caught: false };
  }
  function newGame(demo) {
    g = { demo: !!demo, t: 0, wave: 1, shownWave: 1, nextAt: demo ? 0.2 : 0.4, x: W / 2, vx: 0, items: [],
      score: 0, combo: 0, lives: 3, over: false, settled: false, face: 0, squash: 0, parts: [], pops: [], flash: 0, invuln: 0, safeUntil: -1, plan: { t: 0, x: W / 2 }, rng: Math.random };
  }
  function axis() {
    let a = (keys.right || touch.right ? 1 : 0) - (keys.left || touch.left ? 1 : 0);
    return clamp(a, -1, 1);
  }
  function puff(x, y, n, c) { for (let i = 0; i < n; i++) g.parts.push({ x: x + (Math.random() - 0.5) * 10, y, vx: (Math.random() - 0.5) * 50, vy: -Math.random() * 40, life: 0.3 + Math.random() * 0.25, c }); }
  function pop(x, y, str, c) { g.pops.push({ x, y, str, c: c || '#ffe08a', t: 0 }); }
  function resolve(it, caught) {
    const good = it.type === 'coffee' || it.type === 'star';
    if (!caught) { if (good) { g.combo = 0; if (!g.demo) Sfx.miss(); } return; }
    if (good) {
      g.combo++;
      const prevTier = Math.floor((g.combo - 1) / 5), tier = Math.floor(g.combo / 5);
      const mult = 1 + 0.25 * Math.min(3, tier);
      const add = Math.floor((it.type === 'star' ? 30 : 10) * mult);
      g.score += add;
      pop(it.x, CUP_Y - 16, '+' + add + (it.type === 'star' ? ' ★' : ' ☕'), it.type === 'star' ? '#ffe08a' : '#ffd9a0');
      puff(it.x, CUP_Y, it.type === 'star' ? 8 : 4, it.type === 'star' ? '#ffe08a' : '#fff');
      if (!g.demo) { Sfx.catch(it.type); if (tier > prevTier && tier > 0) Sfx.combo(); }
      g.squash = 1;
    } else if (!g.demo) {
      g.combo = 0;
      g.lives = Math.max(0, g.lives - (it.type === 'alarm' ? 2 : 1));
      g.flash = 0.35;
      pop(it.x, CUP_Y - 18, it.type === 'alarm' ? '額度警報 −2' : '蟲子 −1', '#ff9d9d');
      puff(it.x, CUP_Y, 10, '#ff5f57');
      if (it.type === 'alarm') Sfx.alarm(); else Sfx.hurt();
      if (g.lives <= 0) g.over = true;
    }
  }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, DT);
    if (mode === 'dying') { g.t += dt; g.flash = Math.max(0, g.flash - dt); return; }
    const end = g.t + dt, x0 = g.x;
    const dragging = drag.on && !g.demo && mode === 'play';
    const goal = dragging ? clamp(drag.x, 15, 165) : null;
    const ax = g.demo ? Math.sin(g.t * 1.3) : (mode === 'play' ? axis() : 0);
    function playerAt(elapsed) {
      const reach = SPEED * elapsed;
      return goal != null ? x0 + clamp(goal - x0, -reach, reach) : clamp(x0 + ax * reach, 15, 165);
    }
    while (g.nextAt <= end) {   // 依杯口抵達時間規劃路徑，保證至少有一條「全接好物、全避壞物」的走法
      const b = g.nextAt, w = waveAt(b), flight = CUP_Y / fallVy(w), p = g.plan;
      const earliest = p.t + 0.32 - flight;
      if (b < earliest) { g.nextAt = earliest; continue; }
      const it = spawnItem(b, w, g.rng), tArr = b + flight;
      const reach = SPEED * Math.max(0, tArr - p.t - 0.18);
      const lo = Math.max(15, p.x - reach), hi = Math.min(165, p.x + reach);
      if (it.type === 'star' || it.type === 'coffee') {
        it.x = lo + g.rng() * Math.max(0, hi - lo); p.x = it.x;
      } else if (Math.abs(it.x - p.x) < 22) {
        const leftRoom = p.x - 15, rightRoom = 165 - p.x;
        it.x = rightRoom >= leftRoom ? Math.min(165, p.x + 22 + g.rng() * 20) : Math.max(15, p.x - 22 - g.rng() * 20);
      }
      p.t = tArr; g.items.push(it); g.nextAt = b + interval(w);
    }
    const events = [];
    for (const it of g.items) {
      const cross = it.born + CUP_Y / it.vy;
      if (!it.passed && cross <= end) events.push({ cross, it });
    }
    events.sort((a, b) => a.cross - b.cross);
    let stop = end;
    for (const { cross, it } of events) {
      it.passed = true;
      it.caught = Math.abs(it.x - playerAt(cross - g.t)) <= 12 + IR;
      const hurt = it.caught && !g.demo && (it.type === 'bug' || it.type === 'alarm');
      if (hurt && cross < (g.safeUntil ?? -1)) { it.caught = false; continue; }  // 無敵期間危險物不算扣命
      if (hurt) g.safeUntil = cross + 0.4;
      resolve(it, it.caught);
      if (g.over) { stop = cross; break; }
    }
    g.x = playerAt(stop - g.t);
    g.t = stop;
    const w = waveAt(stop);
    if (w > g.shownWave) { g.shownWave = w; g.wave = w; if (!g.demo) { Sfx.wave(); pop(W / 2, 40, `第 ${w} 波`, '#9ef0c8'); } }
    else g.wave = w;
    for (const it of g.items) it.y = -IR + (stop - it.born) * it.vy;
    g.items = g.items.filter(it => it.born <= stop && !it.caught && it.y - IR < H + 8);
    g.squash = Math.max(0, g.squash - dt * 6);
    g.flash = Math.max(0, g.flash - dt);
    g.invuln = Math.max(0, (g.safeUntil ?? 0) - stop);
    if (Math.abs(g.x - x0) > 0.4) g.face = g.x < x0 ? -1 : 1; else if (!ax) g.face = 0;
    for (const q of g.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 180 * dt; q.life -= dt; }
    g.parts = g.parts.filter(q => q.life > 0);
    for (const q of g.pops) q.t += dt;
    g.pops = g.pops.filter(q => q.t < 0.9);
    if (g.over && !g.demo) gameOver();
    if (g.demo && g.t > 20) newGame(true);
  }

  function drawBg() {
    for (let i = 0; i < 8; i++) R(0, i * 28, W, 29, i < 5 ? (i % 2 ? '#cfe8f4' : '#b9dff0') : '#d6c4a3');
    R(0, 200, W, 80, '#c4a574'); R(0, 200, W, 3, '#8a6a3e');
    // 窗戶
    R(20, 20, 50, 50, '#8fbde0'); R(22, 22, 21, 21, '#e8f6ff'); R(45, 22, 21, 21, '#d9f0ff'); R(22, 46, 21, 21, '#cfe8f4'); R(45, 46, 21, 21, '#b9dff0');
    R(110, 24, 46, 44, '#8fbde0'); R(112, 26, 20, 19, '#e8f6ff'); R(134, 26, 20, 19, '#d9f0ff'); R(112, 47, 20, 19, '#cfe8f4'); R(134, 47, 20, 19, '#b9dff0');
    // 書櫃剪影
    R(4, 150, 18, 50, '#6b3d1e'); for (let i = 0; i < 4; i++) R(6, 153 + i * 12, 14, 9, ['#c0392b', '#3498db', '#f1c40f', '#2ecc71'][i]);
    R(158, 160, 16, 40, '#c0392b'); R(160, 164, 12, 16, '#9fd8f5');
    // 地板木紋
    R(0, 248, W, 32, '#a47a45'); R(0, 248, W, 2, '#7a5428');
    for (let x = 0; x < W; x += 16) R(x, 248, 1, 32, '#8d6433');
  }
  function drawItem(it) {
    const x = Math.round(it.x), y = Math.round(it.y);
    if (y < -12 || y > H + 8) return;
    if (it.type === 'coffee') {
      R(x - 4, y - 3, 7, 7, '#fff'); R(x - 4, y - 3, 7, 2, '#6b3d1e'); R(x + 3, y - 1, 2, 3, '#fff');
      R(x - 2, y, 3, 2, '#e85d4a'); R(x - 2, y - 7, 1, 2, 'rgba(255,255,255,.8)');
    } else if (it.type === 'star') {
      const c = Math.floor(g.t * 6) % 2 ? '#ffe08a' : '#ffd65a';
      R(x - 1, y - 5, 2, 3, c); R(x - 5, y - 2, 10, 2, c); R(x - 3, y, 6, 2, c); R(x - 4, y + 2, 3, 2, c); R(x + 1, y + 2, 3, 2, c);
    } else if (it.type === 'bug') {
      R(x - 5, y - 3, 10, 6, '#4a2a70'); R(x - 3, y - 5, 6, 3, '#6b3d9a');
      R(x - 3, y - 1, 2, 2, '#ffe08a'); R(x + 1, y - 1, 2, 2, '#ffe08a');
      R(x - 6, y + 1, 3, 1, '#2a1540'); R(x + 3, y + 1, 3, 1, '#2a1540'); R(x - 1, y + 3, 2, 2, '#2a1540');
    } else {
      const flash = Math.floor(g.t * 6) % 2;
      R(x - 8, y - 5, 16, 10, '#e0443b'); R(x - 6, y - 7, 12, 4, '#ff5f57');
      R(x - 4, y - 2, 2, 2, '#1a1a2a'); R(x + 2, y - 2, 2, 2, '#1a1a2a');
      if (flash) { R(x - 1, y - 12, 2, 4, '#ffe08a'); R(x - 1, y - 7, 2, 1, '#ffe08a'); }
    }
  }
  function drawPlayer() {
    const c = CHARS[charIdx] || { color: '#5a9fd6', accent: '#2f6aa0', id: 'da-zhaowang' };
    const rec = sheets[c.id], feet = CUP_Y + 4;
    let sx = 1, sy = 1;
    if (g.squash > 0) { sx = 1 + 0.18 * g.squash; sy = 1 - 0.16 * g.squash; }
    if (g.flash > 0 && Math.floor(g.t * 20) % 2) { /* 受傷閃爍：略過這一幀身體 */ } else if (rec && rec.ok) {
      const row = g.face < 0 ? 1 : g.face > 0 ? 2 : 0;
      const col = g.face !== 0 ? 1 + (Math.floor(g.t * 8) % 2) : 0;
      const dw = Math.round(28 * sx * k), dh = Math.round(28 * sy * k);
      const footPx = (64 - rec.pad) / 64 * 28 * sy;
      const dx = Math.round(g.x * k - dw / 2), dy = Math.round((feet - footPx) * k);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rec.img, col * 64, row * 64, 64, 64, dx, dy, dw, dh);
    } else {
      R(g.x - 8 * sx, feet - 20 * sy, 16 * sx, 16 * sy, c.color);
    }
    // 杯口（接取判定的視覺）
    const cx = g.x, cy = CUP_Y;
    R(cx - 12, cy - 2, 24, 3, '#fff'); R(cx - 11, cy - 1, 22, 6, '#f4f4f8'); R(cx - 11, cy - 1, 22, 1, '#c9d0e6');
    R(cx + 12, cy, 3, 4, '#f4f4f8'); R(cx - 10, cy + 1, 8, 3, '#e85d4a');
  }
  function render() {
    ctx.imageSmoothingEnabled = false;
    drawBg();
    for (const it of g.items) drawItem(it);
    for (const q of g.parts) if (q.life > 0) R(q.x, q.y, q.life > 0.2 ? 2 : 1, q.life > 0.2 ? 2 : 1, q.c);
    drawPlayer();
    for (const q of g.pops) text(q.str, q.x, q.y - q.t * 20, 7, q.c, 'center', 'rgba(10,13,24,.7)');
    if (g.flash > 0) { ctx.fillStyle = `rgba(255,70,60,${g.flash * 0.28})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (!g.demo) updateHud();
  }
  let hudSig = '';
  function updateHud() {
    const hearts = '♥'.repeat(g.lives) + '♡'.repeat(Math.max(0, 3 - g.lives));
    const sig = [g.score, g.wave, g.combo, g.lives, best].join('|');
    if (sig === hudSig) return; hudSig = sig;
    hud.score.textContent = g.score.toLocaleString('en-US');
    hud.wave.textContent = g.wave;
    hud.best.textContent = Math.max(best, g.score).toLocaleString('en-US');
    hud.lives.textContent = hearts;
    const tier = Math.floor(g.combo / 5);
    hud.combo.hidden = g.combo < 2;
    if (g.combo >= 2) hud.combo.textContent = `COMBO ${g.combo}` + (tier ? ` ×${(1 + 0.25 * Math.min(3, tier)).toFixed(2).replace(/0$/, '')}` : '');
  }

  const animating = () => open && !document.hidden && !!g && (mode === 'play' || mode === 'dying' || (mode === 'title' && g.demo));
  function frame(now) {
    rafId = 0;
    if (!animating()) return;
    let left = Math.max(0, (now - last) / 1000); last = now;
    if (mode === 'play' && left > 0.25) { pause(); return; }   // 嚴重卡頓先暫停，避免補算時被砸中
    left = Math.min(left, 0.25);
    while (left > 0 && animating()) { const h = Math.min(left, DT); step(h); left -= h; }
    if (open && !document.hidden) render();
    if (!rafId && animating()) rafId = requestAnimationFrame(frame);
  }
  function startLoop() { if (!rafId && animating()) { last = performance.now(); rafId = requestAnimationFrame(frame); } else if (g && open && !rafId) render(); }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function paintBoards() {
    const B = window.ArcadeBoard; if (!B) return;
    const extra = e => e.floor ? 'W' + e.floor : '—';
    B.render(ui.boardTitle, 'catch', { extra });
    B.render(ui.boardOver, 'catch', { extra, highlightId: lastEntryId });
  }
  function showOverlay(which) {
    for (const [name, el] of Object.entries(ui.ov)) if (el) el.hidden = name !== which;
    hud.bar.hidden = which === 'title';
    if (which === 'over') {
      ui.ovScore.textContent = g.score.toLocaleString('en-US');
      ui.ovWave.textContent = 'W' + g.wave;
      ui.ovBest.textContent = best.toLocaleString('en-US');
      ui.ovRecord.hidden = !g.newRecord;
      if (ui.ovRank) { ui.ovRank.hidden = !g.rank; ui.ovRank.textContent = g.rank ? `🎉 進入前五名 · 第 ${g.rank} 名` : ''; }
    }
    if (which === 'title' || which === 'over') paintBoards();
    if (which === 'title') renderChars();
    const target = { title: ui.startBtn, over: ui.again, paused: ui.resumeBtn }[which];
    if (target && open && !document.hidden) target.focus({ preventScroll: true });
  }
  function startGame() {
    Sfx.ensure(); clearInput(); newGame(false); hudSig = ''; lastEntryId = null; mode = 'play';
    showOverlay(null); canvas.focus({ preventScroll: true }); startLoop();
  }
  function toTitle() { mode = 'title'; lastEntryId = null; newGame(true); showOverlay('title'); startLoop(); }
  function pause() { if (mode === 'play') { mode = 'paused'; stopLoop(); clearInput(); showOverlay('paused'); } }
  function resume() { if (mode === 'paused') { Sfx.ensure(); mode = 'play'; showOverlay(null); canvas.focus({ preventScroll: true }); last = performance.now(); startLoop(); } }
  function gameOver() {
    if (g.demo) { newGame(true); return; }
    if (mode === 'over' || g.settled) return;
    g.settled = true;
    mode = 'over';
    const B = window.ArcadeBoard;
    const result = B ? B.submit('catch', { score: g.score, floor: g.wave, character: (CHARS[charIdx] || {}).name }) : null;
    g.rank = result ? result.rank : 0;
    g.newRecord = result ? result.newRecord : g.score > best;
    lastEntryId = result && result.entered ? result.entry.id : null;
    best = boardBest();
    Sfx.over(); if (g.newRecord) Sfx.record();
    showOverlay('over'); stopLoop();
  }
  function clearInput() { keys.left = keys.right = touch.left = touch.right = false; drag.on = false; ui.btnL && ui.btnL.classList.remove('on'); ui.btnR && ui.btnR.classList.remove('on'); }
  function renderChars() {
    if (!ui.chars) return;
    ui.chars.innerHTML = '';
    CHARS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'qj-char' + (i === charIdx ? ' on' : '') + (c.bonus ? ' bonus' : '');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(i === charIdx));
      b.innerHTML = `<img src="assets/characters/${c.id}-avatar.png" alt="" width="40" height="40"><b>${c.name}</b><small>${c.bonus ? '★ ' : ''}${c.tag}</small>`;
      b.addEventListener('click', () => { charIdx = i; store.set(KEY_CHAR, i); Sfx.ensure(); Sfx.select(); renderChars(); ui.startBtn.focus({ preventScroll: true }); });
      ui.chars.appendChild(b);
    });
    if (ui.startName) ui.startName.textContent = (CHARS[charIdx] || {}).name || '';
  }
  function syncMute() {
    ui.mute.textContent = muted ? '🔇' : '🔊';
    ui.mute.setAttribute('aria-pressed', String(!muted));
    ui.mute.title = muted ? '音效：關（按一下開啟）' : '音效：開（按一下關閉）';
  }
  function resize() {
    if (!open) return;
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const h = Math.max(H, Math.round(Math.min(r.height, r.width * H / W) * dpr)), w = Math.round(h * W / H);
    if (canvas.height !== h || canvas.width !== w) { canvas.height = h; canvas.width = w; }
    k = canvas.height / H;
    if (g && !rafId) render();
  }
  function openGame(from) {
    if (!modal || open) return;
    const opts = from && typeof from === 'object' && (from.fromMenu || from.opener) ? from : { opener: from };
    fromMenu = !!opts.fromMenu; opener = opts.opener || document.activeElement;
    open = true; modal.hidden = false; document.body.classList.add('qj-open');
    best = boardBest(); loadSheets();   // 重開同一結算頁時保留 lastEntryId，改名才改得到該筆
    if (window.Office) window.Office.setActive(false);
    if (!ro) ro = new ResizeObserver(resize);
    ro.observe(canvas); resize();
    if (mode === 'play') mode = 'paused';
    if (!g || mode === 'title') toTitle(); else { showOverlay(mode === 'over' ? 'over' : 'paused'); render(); }
    startLoop();
  }
  function closeGame(opts) {
    if (!open) return;
    if (mode === 'play') mode = 'paused';
    const silent = opts && opts.silent, back = fromMenu && window.Arcade && !silent;
    open = false; modal.hidden = true; stopLoop(); clearInput();
    if (ro) ro.disconnect();
    if (back) window.Arcade.gameClosed();
    else {
      document.body.classList.remove('qj-open');
      if (window.Office) window.Office.setActive(!document.hidden && !(window.Arcade && window.Arcade.isBusy()));
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    }
    fromMenu = false; opener = null;
  }

  const isLeft = e => e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
  const isRight = e => e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';
  function onKeyDown(e) {
    if (!open || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      const typing = e.target && e.target.closest && e.target.closest('input, textarea');
      if (typing) { e.target.blur(); return; }   // 第一次 Esc 先離開名字欄，再按一次才關閉
      closeGame(); return;
    }
    if (e.key === 'Tab') { trapFocus(e); return; }
    if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.repeat) { e.preventDefault(); return; }
      if (e.target && e.target.closest && e.target.closest('button, input')) return;
      e.preventDefault();
      if (mode === 'title' || mode === 'over') startGame(); else if (mode === 'paused') resume();
      return;
    }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (!e.repeat) { if (mode === 'play') pause(); else if (mode === 'paused') resume(); } return; }
    if (mode !== 'play') return;
    if (isLeft(e)) keys.left = true; else if (isRight(e)) keys.right = true;
    else if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
  }
  function onKeyUp(e) { if (isLeft(e)) keys.left = false; if (isRight(e)) keys.right = false; }
  function trapFocus(e) {
    const f = [...modal.querySelectorAll('button:not(:disabled), input:not([disabled]), [tabindex="0"]')].filter(el => !el.closest('[hidden]') && el.getClientRects().length);
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus({ preventScroll: true }); }
  }
  function canvasX(e) { const r = canvas.getBoundingClientRect(); return (e.clientX - r.left) / r.width * W; }
  function holdBtn(btn, side) {
    let owner = null;
    const on = e => { e.preventDefault(); if (!open || mode !== 'play' || owner != null) return; owner = e.pointerId; touch[side] = true; drag.on = false; btn.classList.add('on'); try { btn.setPointerCapture(e.pointerId); } catch (x) {} };
    const off = e => { if (owner != null && e.pointerId !== owner) return; owner = null; touch[side] = false; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, off));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }

  function init() {
    modal = document.getElementById('ccModal'); if (!modal) return;
    canvas = document.getElementById('ccCanvas'); ctx = canvas.getContext('2d', { alpha: false });
    const $ = s => modal.querySelector(s);
    hud = { bar: $('.qj-hud'), score: $('#ccScore'), wave: $('#ccWave'), best: $('#ccBest'), combo: $('#ccCombo'), lives: $('#ccLives') };
    ui = {
      ov: { title: $('#ccTitle'), over: $('#ccOver'), paused: $('#ccPaused') },
      chars: $('#ccChars'), startBtn: $('#ccStart'), startName: $('#ccStartName'),
      ovScore: $('#ccOvScore'), ovWave: $('#ccOvWave'), ovBest: $('#ccOvBest'), ovRecord: $('#ccOvRecord'), ovRank: $('#ccOvRank'),
      boardTitle: $('#ccBoardTitle'), boardOver: $('#ccBoardOver'),
      again: $('#ccAgain'), resumeBtn: $('#ccResume'), mute: $('#ccMute'), btnL: $('#ccLeft'), btnR: $('#ccRight'),
    };
    if (window.ArcadeBoard) {
      ArcadeBoard.bindNameInput($('#ccName')); ArcadeBoard.bindNameInput($('#ccNameOver'));
      ArcadeBoard.onName(() => { if (open && mode === 'over' && lastEntryId) ArcadeBoard.rename('catch', lastEntryId, ArcadeBoard.getName()); if (open) paintBoards(); });
    }
    ui.startBtn.addEventListener('click', startGame);
    ui.again.addEventListener('click', startGame);
    $('#ccChange').addEventListener('click', toTitle);
    const toMenu = $('#ccToMenu'); if (toMenu) toMenu.addEventListener('click', () => closeGame());
    ui.resumeBtn.addEventListener('click', resume);
    $('#ccRestart').addEventListener('click', startGame);
    $('#ccClose').addEventListener('click', closeGame);
    modal.addEventListener('pointerdown', e => { if (e.target === modal && e.pointerType === 'mouse') closeGame(); });
    ui.mute.addEventListener('click', () => { muted = !muted; store.set(KEY_MUTE, muted ? '1' : '0'); syncMute(); if (!muted) { Sfx.ensure(); Sfx.select(); } });
    syncMute();
    for (const el of [canvas, ui.btnL, ui.btnR]) if (el) el.style.touchAction = 'none';
    holdBtn(ui.btnL, 'left'); holdBtn(ui.btnR, 'right');
    canvas.addEventListener('pointerdown', e => {
      if (mode !== 'play' || drag.on || touch.left || touch.right || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag.on = true; drag.id = e.pointerId; drag.x = canvasX(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => { if (drag.on && e.pointerId === drag.id) drag.x = canvasX(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => canvas.addEventListener(ev, e => { if (e.pointerId === drag.id) drag.on = false; }));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => { clearInput(); if (open) pause(); });
    document.addEventListener('visibilitychange', () => {
      if (!open) return;
      if (document.hidden) { clearInput(); pause(); stopLoop(); } else { resize(); startLoop(); }
    });
    best = boardBest();
    hud.best.textContent = best.toLocaleString('en-US');
    if (window.Arcade) window.Arcade.register({ id: 'catch', title: '沼王接咖啡', emoji: '☕', blurb: '幫沼王接滿咖啡，別讓額度警報砸下來！', open: openGame, close: closeGame, isOpen: () => open });
  }

  window.CoffeeCatch = {
    open: openGame, close: closeGame, isOpen: () => open,
    debug: () => g && { mode, x: +g.x.toFixed(1), score: g.score, wave: g.wave, lives: g.lives, combo: g.combo, running: !!rafId, best, items: g.items.length },
    __forceOver: () => { if (g && (mode === 'play' || mode === 'title')) { g.demo = false; g.score = Math.max(g.score, 1); g.wave = Math.max(g.wave, 1); g.over = true; gameOver(); } },
    __setState: o => { if (!g) return; Object.assign(g, o || {}); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
