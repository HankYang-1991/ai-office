/* 走廊衝刺（Office Hallway Dash）：橫向無盡跑者，跳過家具、蹲閃額度警報雲。
 * 純前端 Canvas + Web Audio，不呼叫 API。玩法數值由量化分析師（OpenAI gpt-6.2-astra）設計。
 * 邏輯解析度 320×180；名字與前五名走共用的 ArcadeBoard。
 */
(function () {
  'use strict';
  const W = 320, H = 180, G = 150, PW = 14, STAND = 24, DUCK = 11, GRAV = 1000, JUMP = -280, VMAX = 190, DT = 0.05;
  const KEY_CHAR = 'aiOffice.hallwayDashChar', KEY_MUTE = 'aiOffice.hallwayDashMute';
  const CHARS = (window.Arcade && Arcade.CHARS) || [];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const speedAt = d => Math.min(VMAX, 110 + d / 100);
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const flabel = n => 'F' + String(Math.max(1, n)).padStart(2, '0');

  let modal, canvas, ctx, hud = {}, ui = {}, opener = null;
  let k = 2, open = false, rafId = 0, last = 0, ro = null;
  let mode = 'title', g = null, charIdx = clamp(parseInt(store.get(KEY_CHAR, '0'), 10) || 0, 0, Math.max(0, CHARS.length - 1));
  const boardBest = () => (window.ArcadeBoard ? ArcadeBoard.bestScore('dash') : 0);
  let best = 0, lastEntryId = null, fromMenu = false, muted = store.get(KEY_MUTE, '0') === '1';
  const input = { jump: false, duck: false, jumpTap: false };
  const held = { jump: new Set(), duck: new Set() };
  function action(k, id, down) {
    const set = held[k];
    if (down) { if (mode !== 'play' || set.has(id)) return; set.add(id); if (k === 'jump') input.jumpTap = true; }
    else set.delete(id);
    input[k] = set.size > 0;
  }
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
      jump: () => tone(280, 520, 0.1, 'square', 0.3),
      land: () => tone(180, 120, 0.06, 'triangle', 0.2),
      duck: () => tone(200, 160, 0.05, 'square', 0.16),
      coffee: () => { tone(880, 880, 0.06, 'square', 0.28); tone(1320, 1320, 0.08, 'square', 0.28, 0.06); },
      star: () => { [1047, 1319, 1568].forEach((f, i) => tone(f, f, 0.07, 'square', 0.28, i * 0.05)); },
      hurt: () => { tone(500, 90, 0.35, 'sawtooth', 0.4); },
      floor: () => { tone(784, 784, 0.07, 'triangle', 0.3); tone(1175, 1175, 0.1, 'triangle', 0.3, 0.08); },
      over: () => { [523, 392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.16, 'square', 0.3, 0.08 + i * 0.16)); },
      record: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.1, 'square', 0.28, 0.8 + i * 0.09)); },
      select: () => tone(660, 880, 0.06, 'square', 0.25),
    };
  })();

  function loadSheets() { if (window.Arcade) Arcade.loadSheets(CHARS, sheets); }

  function R(x, y, w, h, c) {
    const x0 = Math.round(x * k), y0 = Math.round(y * k);
    ctx.fillStyle = c; ctx.fillRect(x0, y0, Math.max(1, Math.round((x + w) * k) - x0), Math.max(1, Math.round((y + h) * k) - y0));
  }
  function text(str, x, y, size, color, align, outline) {
    ctx.font = `700 ${Math.round(size * k)}px ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace`;
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    if (outline) { ctx.lineWidth = Math.max(2, Math.round(k)); ctx.strokeStyle = outline; ctx.strokeText(str, Math.round(x * k), Math.round(y * k)); }
    ctx.fillStyle = color; ctx.fillText(str, Math.round(x * k), Math.round(y * k));
  }
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function spawnAhead(s) {
    const rng = s.rng, int = n => Math.floor(rng() * n);
    while (s.next < s.d + 480) {
      const x = s.next;
      const cloud = s.groups === 1 || (s.groups > 1 && rng() < 0.44);
      let end;
      if (cloud) {
        const w = 24 + int(9);
        s.obs.push({ kind: 'cloud', x, y: 90, w, h: 44 });
        end = x + w;
        if (x > 1200 && rng() < 0.35) { s.obs.push({ kind: 'cloud', x: end + 8, y: 90, w: 22, h: 44 }); end += 30; }
      } else {
        const w = 14 + int(5), h = 11 + int(4);
        s.obs.push({ kind: int(2) ? 'cabinet' : 'box', x, y: G - h, w, h });
        end = x + w;
        if (rng() < 0.7) s.items.push({ kind: 'star', x: x + w / 2 - 3, y: G - 65, w: 6, h: 6 });
      }
      if (rng() < 0.6) s.items.push({ kind: 'coffee', x: end + 95, y: G - 8, w: 7, h: 8 });
      const rest = Math.max(0.85, 1.55 - end / 10000);   // 以當前速度給足換姿時間，再用最高速設硬下限（OpenAI 建議）
      s.next = end + PW + Math.ceil(Math.max(VMAX * 0.8, speedAt(end) * rest)) + int(16);
      s.groups++;
    }
  }
  function newGame(demo) {
    g = { demo: !!demo, d: 0, foot: G, vy: 0, h: STAND, prevJump: false, dead: false, coyote: 0, buffer: 0,
      next: 220, groups: 0, obs: [], items: [], coffee: 0, star: 0, score: 0, floor: 1, shownFloor: 1,
      parts: [], pops: [], squash: 0, t: 0, ducked: false, rng: Math.random };
    spawnAhead(g);
  }
  function puff(x, y, n, c) { for (let i = 0; i < n; i++) g.parts.push({ x: x + (Math.random() - 0.5) * 8, y, vx: (Math.random() - 0.5) * 40, vy: -Math.random() * 40, life: 0.25 + Math.random() * 0.2, c }); }
  function pop(x, y, str, c) { g.pops.push({ x, y, str, c: c || '#ffe08a', t: 0 }); }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || g.dead) return;
    dt = Math.min(dt, DT);
    g.t += dt;
    const n = Math.max(1, Math.ceil(dt * 120)), t = dt / n;
    const wantJump = (g.demo || mode === 'play') ? input.jump : false;
    const wantDuck = (g.demo || mode === 'play') ? input.duck : false;
    if (g.demo) { /* 示範：看到障礙自動跳或蹲 */ }
    if (input.jumpTap) { g.buffer = 0.1; input.jumpTap = false; }
    else if (wantJump && !g.prevJump) g.buffer = 0.1;
    g.prevJump = wantJump;
    for (let i = 0; i < n && !g.dead; i++) {
      const grounded = g.foot >= G - 0.01 && g.vy >= 0;
      if (grounded) { g.foot = G; g.vy = 0; g.coyote = 0.07; }
      else g.coyote = Math.max(0, g.coyote - t);
      g.buffer = Math.max(0, g.buffer - t);
      const duck = grounded && wantDuck;
      if (duck && !g.ducked && !g.demo) Sfx.duck();
      g.ducked = duck;
      g.h = duck ? DUCK : STAND;
      if (g.buffer > 0 && g.coyote > 0 && !duck) {
        g.vy = JUMP; g.coyote = 0; g.buffer = 0; g.squash = 1;
        if (!g.demo) Sfx.jump(); puff(g.d + 52, G, 4, '#e8f4ff');
      }
      if (!grounded || g.vy < 0) {
        g.foot += g.vy * t + 0.5 * GRAV * t * t;
        g.vy += GRAV * t;
        if (g.foot >= G && g.vy >= 0) { g.foot = G; g.vy = 0; if (!g.demo) Sfx.land(); }
      }
      const sp = speedAt(g.d);
      g.d += sp * t;
      spawnAhead(g);
      const p = { x: g.d + 46, y: g.foot - g.h, w: PW, h: g.h };
      if (g.obs.some(o => hit(p, o))) { g.dead = true; if (!g.demo) Sfx.hurt(); break; }
      g.items = g.items.filter(it => {
        if (hit(p, it)) {
          g[it.kind] = (g[it.kind] || 0) + 1;
          const add = it.kind === 'star' ? 30 : 10;
          pop(it.x, it.y - 8, '+' + add, it.kind === 'star' ? '#ffe08a' : '#ffd9a0');
          puff(it.x, it.y, 6, it.kind === 'star' ? '#ffe08a' : '#fff');
          if (!g.demo) { if (it.kind === 'star') Sfx.star(); else Sfx.coffee(); }
          return false;
        }
        return it.x + it.w >= g.d - 10;
      });
      g.obs = g.obs.filter(o => o.x + o.w >= g.d - 20);
    }
    g.score = Math.floor(g.d / 10) + 10 * g.coffee + 30 * g.star;
    g.floor = 1 + Math.floor(g.d / 1000);
    if (g.floor > g.shownFloor) { g.shownFloor = g.floor; if (!g.demo) { Sfx.floor(); pop(g.d + 70, 40, flabel(g.floor) + ' 抵達！', '#9ef0c8'); } }
    g.squash = Math.max(0, g.squash - dt * 6);
    for (const q of g.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 180 * dt; q.life -= dt; }
    g.parts = g.parts.filter(q => q.life > 0);
    for (const q of g.pops) q.t += dt;
    g.pops = g.pops.filter(q => q.t < 0.9);
    if (g.dead && !g.demo) gameOver();
    if (g.demo && (g.dead || g.d > 1800)) newGame(true);
  }

  // 示範 AI：靠近障礙就跳或蹲
  function demoThink() {
    if (!g || !g.demo) return;
    input.jump = input.duck = false;
    const px = g.d + 46;
    const soon = g.obs.find(o => o.x + o.w > px && o.x < px + 70);
    if (!soon) return;
    if (soon.kind === 'cloud') input.duck = soon.x - px < 50;
    else if (soon.kind === 'cabinet' || soon.kind === 'box') { if (soon.x - px < 36 && g.foot >= G) input.jump = true; }
  }

  function drawBg() {
    const cam = g.d;
    // 牆要畫滿到地面，避免中間露出畫布黑底
    R(0, 0, W, G, '#d8c7a1');
    for (let i = 0; i < 8; i++) R(0, i * 18, W, 19, i % 2 ? '#d8c7a1' : '#d2c19b');
    R(0, G - 8, W, 8, '#c4b089');
    R(0, G, W, H - G, '#a47a45'); R(0, G, W, 3, '#6b4e28');
    for (let x = -((cam * 0.5) % 24); x < W; x += 24) R(x, G + 4, 1, H - G, '#7a5a30');
    // 遠門與海報（視差）
    const pcam = cam * 0.35;
    for (let i = -1; i < 8; i++) {
      const x = ((i * 90) - (pcam % 90));
      R(x + 10, 40, 28, 70, '#b9a57e'); R(x + 14, 46, 20, 60, '#6d7c9b');
      const poster = hash(Math.floor((cam * 0.35 + i * 90) / 90));
      R(x + 48, 50, 16, 20, poster > 0.5 ? '#6fb7e8' : '#e85d4a');
    }
    // 天花板燈
    for (let x = -((cam * 0.8) % 64); x < W; x += 64) { R(x + 20, 8, 18, 4, '#fff3c2'); R(x + 24, 12, 10, 1, 'rgba(255,243,194,.35)'); }
    // 樓層線
    const f0 = Math.max(1, 1 + Math.floor((cam - 40) / 1000)), f1 = 1 + Math.floor((cam + W + 40) / 1000);
    for (let f = f0; f <= f1; f++) {
      const x = f * 1000 - cam;
      if (x > -10 && x < W + 10) { for (let y = 20; y < G; y += 8) R(x, y, 1, 4, 'rgba(255,255,255,.25)'); text(flabel(f), x + 8, 24, 6, 'rgba(255,255,255,.7)', 'left'); }
    }
  }
  function drawObs(o) {
    const x = o.x - g.d;
    if (x + o.w < -8 || x > W + 8) return;
    if (o.kind === 'cloud') {
      const flash = Math.floor(g.t * 6) % 2;
      R(x, o.y + 8, o.w, o.h - 16, '#e0443b'); R(x + 2, o.y, o.w - 4, 10, '#ff5f57'); R(x + 2, o.y + o.h - 10, o.w - 4, 8, '#b8322b');
      R(x + o.w / 2 - 5, o.y + 16, 3, 3, '#1a1a2a'); R(x + o.w / 2 + 2, o.y + 16, 3, 3, '#1a1a2a');
      if (flash) R(x + o.w / 2 - 1, o.y - 8, 2, 6, '#ffe08a');
    } else if (o.kind === 'cabinet') {
      R(x, o.y, o.w, o.h, '#8395a7'); R(x + 1, o.y + 1, o.w - 2, 4, '#a4b0be'); R(x + o.w / 2 - 1, o.y + 3, 2, 1, '#57606f');
    } else {
      R(x, o.y, o.w, o.h, '#c9a46e'); R(x + 1, o.y + 1, o.w - 2, 2, '#e6c995'); R(x + 3, o.y + 4, o.w - 6, 1, '#6d4f28');
    }
  }
  function drawItem(it) {
    const x = Math.round(it.x - g.d), y = Math.round(it.y);
    if (x < -10 || x > W + 10) return;
    if (it.kind === 'coffee') {
      R(x - 3, y - 6, 7, 7, '#fff'); R(x - 3, y - 6, 7, 2, '#6b3d1e'); R(x + 4, y - 4, 2, 3, '#fff'); R(x - 1, y - 3, 3, 2, '#e85d4a');
    } else {
      const c = Math.floor(g.t * 6) % 2 ? '#ffe08a' : '#ffd65a';
      R(x, y - 5, 2, 3, c); R(x - 3, y - 2, 8, 2, c); R(x - 1, y, 4, 2, c);
    }
  }
  function drawPlayer() {
    const c = CHARS[charIdx] || { color: '#5a9fd6', id: 'da-zhaowang' };
    const rec = sheets[c.id];
    const px = 46 + PW / 2, feet = g.foot;
    let sx = 1, sy = 1;
    if (g.squash > 0) { sx = 1 + 0.2 * g.squash; sy = 1 - 0.18 * g.squash; }
    else if (g.vy < 0) { const st = clamp(-g.vy / 280, 0, 1) * 0.12; sx = 1 - st * 0.5; sy = 1 + st; }
    if (g.ducked) { sx = 1.15; sy = 0.72; }
    const run = g.foot >= G && !g.ducked;
    if (rec && rec.ok) {
      const row = 2; // 面朝右跑
      const col = run ? 1 + (Math.floor(g.t * (8 + speedAt(g.d) / 40)) % 2) : 0;
      const spr = g.ducked ? 22 : 28;
      const dw = Math.round(spr * sx * k), dh = Math.round(spr * sy * k);
      const footPx = (64 - rec.pad) / 64 * spr * sy;
      const dx = Math.round(px * k - dw / 2), dy = Math.round((feet - footPx) * k);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rec.img, col * 64, row * 64, 64, 64, dx, dy, dw, dh);
    } else {
      R(px - 7, feet - g.h, 14, g.h, c.color);
    }
  }
  function render() {
    ctx.imageSmoothingEnabled = false;
    drawBg();
    for (const o of g.obs) drawObs(o);
    for (const it of g.items) drawItem(it);
    for (const q of g.parts) { const x = q.x - g.d; if (x > -4 && x < W) R(x, q.y, 2, 2, q.c); }
    drawPlayer();
    for (const q of g.pops) text(q.str, q.x - g.d, q.y - q.t * 16, 7, q.c, 'center', 'rgba(10,13,24,.7)');
    if (!g.demo) updateHud();
  }
  let hudSig = '';
  function updateHud() {
    const sig = [g.score, g.floor, best].join('|');
    if (sig === hudSig) return; hudSig = sig;
    hud.score.textContent = g.score.toLocaleString('en-US');
    hud.floor.textContent = flabel(g.floor);
    hud.best.textContent = Math.max(best, g.score).toLocaleString('en-US');
  }

  const animating = () => open && !document.hidden && !!g && (mode === 'play' || (mode === 'title' && g.demo));
  let acc = 0;
  const TICK = 1 / 120;
  function frame(now) {
    rafId = 0;
    if (!animating()) return;
    const elapsed = Math.max(0, (now - last) / 1000); last = now;
    if (elapsed > 0.15 && mode === 'play') { pause(); return; }
    acc += Math.min(elapsed, 0.15);
    while (acc >= TICK && animating()) { acc -= TICK; if (g.demo) demoThink(); step(TICK); }
    if (open && !document.hidden) render();
    if (animating() && !rafId) rafId = requestAnimationFrame(frame);
  }
  function startLoop() { if (!rafId && animating()) { last = performance.now(); acc = 0; rafId = requestAnimationFrame(frame); } else if (g && open && !rafId) render(); }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function paintBoards() {
    const B = window.ArcadeBoard; if (!B) return;
    const extra = e => e.floor ? flabel(e.floor) : '—';
    B.render(ui.boardTitle, 'dash', { extra });
    B.render(ui.boardOver, 'dash', { extra, highlightId: lastEntryId });
  }
  function showOverlay(which) {
    for (const [name, el] of Object.entries(ui.ov)) if (el) el.hidden = name !== which;
    hud.bar.hidden = which === 'title';
    if (which === 'over') {
      ui.ovScore.textContent = g.score.toLocaleString('en-US');
      ui.ovFloor.textContent = flabel(g.floor);
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
    if (!g || g.demo) { if (g && g.demo) newGame(true); return; }
    if (mode === 'over' || g.submitted) return;
    g.submitted = true;
    mode = 'over';
    const B = window.ArcadeBoard;
    const result = B ? B.submit('dash', { score: g.score, floor: g.floor, character: (CHARS[charIdx] || {}).name }) : null;
    g.rank = result ? result.rank : 0;
    g.newRecord = result ? result.newRecord : g.score > best;
    lastEntryId = result && result.entered ? result.entry.id : null;
    best = boardBest();
    Sfx.over(); if (g.newRecord) Sfx.record();
    showOverlay('over'); stopLoop();
  }
  function clearInput() { held.jump.clear(); held.duck.clear(); input.jump = input.duck = input.jumpTap = false; if (g) { g.buffer = 0; g.prevJump = false; } ui.btnDuck && ui.btnDuck.classList.remove('on'); ui.btnJump && ui.btnJump.classList.remove('on'); }
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
    best = boardBest(); loadSheets();
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

  const isJump = e => e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
  const isDuck = e => e.key === 'ArrowDown' || e.key === 's' || e.key === 'S';
  function onKeyDown(e) {
    if (!open || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable=true]')) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) e.target.blur(); }
      return;
    }
    if (e.key === 'Tab') { trapFocus(e); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) closeGame(); return; }
    if ((e.key === 'Enter' || (e.key === ' ' && mode !== 'play')) && mode !== 'play') {
      if (e.repeat) { e.preventDefault(); return; }
      if (e.target && e.target.closest && e.target.closest('button, input')) return;
      e.preventDefault();
      if (mode === 'title' || mode === 'over') startGame(); else if (mode === 'paused') resume();
      return;
    }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (!e.repeat) { if (mode === 'play') pause(); else if (mode === 'paused') resume(); } return; }
    if (mode !== 'play') return;
    if (isJump(e)) { e.preventDefault(); action('jump', 'k' + e.code, true); }
    else if (isDuck(e)) { e.preventDefault(); action('duck', 'k' + e.code, true); }
  }
  function onKeyUp(e) { if (isJump(e)) action('jump', 'k' + e.code, false); if (isDuck(e)) action('duck', 'k' + e.code, false); }
  function trapFocus(e) {
    const f = [...modal.querySelectorAll('button:not(:disabled), input:not([disabled]), [tabindex="0"]')].filter(el => !el.closest('[hidden]') && el.getClientRects().length);
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus({ preventScroll: true }); }
  }
  function holdBtn(btn, key) {
    let owner = null;
    const on = e => { e.preventDefault(); if (!open || mode !== 'play' || owner != null) return; owner = e.pointerId; action(key, 'p' + e.pointerId, true); btn.classList.add('on'); try { btn.setPointerCapture(e.pointerId); } catch (x) {} };
    const off = e => { if (owner != null && e.pointerId !== owner) return; action(key, 'p' + owner, false); owner = null; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, off));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }

  function init() {
    modal = document.getElementById('hdModal'); if (!modal) return;
    canvas = document.getElementById('hdCanvas'); ctx = canvas.getContext('2d', { alpha: false });
    const $ = s => modal.querySelector(s);
    hud = { bar: $('.qj-hud'), score: $('#hdScore'), floor: $('#hdFloor'), best: $('#hdBest') };
    ui = {
      ov: { title: $('#hdTitle'), over: $('#hdOver'), paused: $('#hdPaused') },
      chars: $('#hdChars'), startBtn: $('#hdStart'), startName: $('#hdStartName'),
      ovScore: $('#hdOvScore'), ovFloor: $('#hdOvFloor'), ovBest: $('#hdOvBest'), ovRecord: $('#hdOvRecord'), ovRank: $('#hdOvRank'),
      boardTitle: $('#hdBoardTitle'), boardOver: $('#hdBoardOver'),
      again: $('#hdAgain'), resumeBtn: $('#hdResume'), mute: $('#hdMute'), btnDuck: $('#hdDuck'), btnJump: $('#hdJump'),
    };
    if (window.ArcadeBoard) {
      ArcadeBoard.bindNameInput($('#hdName')); ArcadeBoard.bindNameInput($('#hdNameOver'));
      ArcadeBoard.onName(() => { if (open && mode === 'over' && lastEntryId) ArcadeBoard.rename('dash', lastEntryId, ArcadeBoard.getName()); if (open) paintBoards(); });
    }
    ui.startBtn.addEventListener('click', startGame);
    ui.again.addEventListener('click', startGame);
    $('#hdChange').addEventListener('click', toTitle);
    const toMenu = $('#hdToMenu'); if (toMenu) toMenu.addEventListener('click', () => closeGame());
    ui.resumeBtn.addEventListener('click', resume);
    $('#hdRestart').addEventListener('click', startGame);
    $('#hdClose').addEventListener('click', closeGame);
    modal.addEventListener('pointerdown', e => { if (e.target === modal && e.pointerType === 'mouse') closeGame(); });
    ui.mute.addEventListener('click', () => { muted = !muted; store.set(KEY_MUTE, muted ? '1' : '0'); syncMute(); if (!muted) { Sfx.ensure(); Sfx.select(); } });
    syncMute();
    for (const el of [canvas, ui.btnDuck, ui.btnJump]) if (el) el.style.touchAction = 'none';
    holdBtn(ui.btnDuck, 'duck');
    holdBtn(ui.btnJump, 'jump');
    canvas.addEventListener('pointerdown', e => {
      if (mode !== 'play' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      action('jump', 'c' + e.pointerId, true);
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => canvas.addEventListener(ev, e => action('jump', 'c' + e.pointerId, false)));
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
    if (window.Arcade) window.Arcade.register({ id: 'dash', title: '走廊衝刺', emoji: '🏃', blurb: '翻過矮櫃、低頭閃警報，順路撿杯咖啡！', open: openGame, close: closeGame, isOpen: () => open });
  }

  window.HallwayDash = {
    open: openGame, close: closeGame, isOpen: () => open,
    debug: () => g && { mode, d: +g.d.toFixed(1), score: g.score, floor: g.floor, vy: +g.vy.toFixed(1), duck: g.ducked, running: !!rafId, best, dead: g.dead, obs: g.obs.length },
    __forceOver: () => { if (g && mode === 'play') { g.dead = true; g.score = Math.max(g.score, 1); gameOver(); } },
    __setState: o => { if (!g) return; Object.assign(g, o || {}); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
