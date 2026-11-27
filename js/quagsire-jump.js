/* 沼王跳跳樂（Quagsire Jump）：Doodle Jump 風格的向上跳台小遊戲。
 * 純前端 Canvas + Web Audio：不呼叫任何 API、不讀寫任何金鑰；只用 localStorage 存最高分、角色與靜音設定。
 * 物理數值、平台間距曲線、平台機率、道具與「紅色額度警報雲」的規則由量化分析師（OpenAI gpt-6.2-astra）設計，
 * 澳洲企鵝整合、調手感並接進 AI 辦公室。邏輯解析度 180×320，依畫布實際像素整數取整繪製，保持像素銳利。
 */
(function () {
  'use strict';
  // ---------- 常數（邏輯像素、秒） ----------
  const W = 180, H = 320, BASE = 290, CAM_LEAD = 132;
  const P = { gravity: 900, jump: -375, spring: -490, accel: 1050, maxVx: 150, friction: 11, maxFall: 460, dtClamp: 0.04 };
  const PW = 38, FEET = 7, BODY = 24, SPR = 32, CELL = 64, STOMP_PTS = 150;   // 踩雲風險最高，分數也最高（OpenAI 建議）
  const KEY_BEST = 'aiOffice.quagsireJumpBest', KEY_CHAR = 'aiOffice.quagsireJumpChar', KEY_MUTE = 'aiOffice.quagsireJumpMute';
  const CHARS = [
    { id: 'da-zhaowang', name: '大沼王', tag: '漫畫家', color: '#5a9fd6', accent: '#2f6aa0' },
    { id: 'codex-xiao-zhaowang', name: '小沼王', tag: '程式開發', color: '#6fb7e8', accent: '#3d7fb0' },
    { id: 'zhaowang-xiaobao', name: '沼王小寶', tag: '攝影師', color: '#8fd0f0', accent: '#4f9cc8' },
    { id: 'jiantou-xiao-zhaowang', name: '尖頭小沼王', tag: '音樂家', color: '#8cdcd2', accent: '#6cc2b9' },
    { id: 'au-penguin', name: '澳洲企鵝', tag: '隱藏夥伴', color: '#5d6b82', accent: '#e85d4a', bonus: true },
  ];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* 無痕模式等情況忽略 */ } },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = x => ((x % W) + W) % W;
  const wdist = (a, b) => Math.abs(wrap(a - b + W / 2) - W / 2);   // 考慮左右穿越的水平距離
  const floorAt = y => Math.max(0, Math.floor((BASE - y) / 100));
  const rnd = Math.random;

  // ---------- 狀態 ----------
  let modal, canvas, ctx, hud = {}, ui = {}, opener = null;
  let k = 2;                      // 每個邏輯像素等於多少畫布像素
  let open = false, rafId = 0, last = 0, ro = null;
  let mode = 'title';             // title | play | dying | over | paused
  let g = null;
  let charIdx = clamp(parseInt(store.get(KEY_CHAR, '0'), 10) || 0, 0, CHARS.length - 1);
  let best = Math.max(0, parseInt(store.get(KEY_BEST, '0'), 10) || 0);
  let muted = store.get(KEY_MUTE, '0') === '1';
  const keys = { left: false, right: false };
  const touch = { left: false, right: false };
  const drag = { on: false, x: 0, id: null };
  const sheets = {};              // id -> { img, pad }

  // ---------- 8-bit 音效（Web Audio，按下開始後才建立） ----------
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
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, delay) {
      if (muted || !ac) return;
      const t = ac.currentTime + (delay || 0), n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource(), gn = ac.createGain(); src.buffer = buf; gn.gain.value = vol || 0.3;
      src.connect(gn); gn.connect(master); src.start(t);
    }
    return {
      ensure,
      jump: () => tone(300, 640, 0.12, 'square', 0.35),
      spring: () => { tone(220, 1200, 0.32, 'triangle', 0.6); tone(523, 523, 0.06, 'square', 0.25, 0.05); tone(784, 784, 0.06, 'square', 0.25, 0.11); tone(1047, 1047, 0.08, 'square', 0.25, 0.17); },
      coffee: () => { tone(988, 988, 0.07, 'square', 0.3); tone(1319, 1319, 0.12, 'square', 0.3, 0.07); },
      star: () => { [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, f, 0.08, 'square', 0.28, i * 0.06)); },
      stomp: () => { tone(420, 90, 0.16, 'square', 0.4); noise(0.08, 0.25); },
      crack: () => { noise(0.1, 0.3); tone(180, 120, 0.08, 'triangle', 0.3); },
      floor: () => { tone(784, 784, 0.07, 'triangle', 0.3); tone(1175, 1175, 0.1, 'triangle', 0.3, 0.08); },
      hurt: () => { tone(600, 80, 0.4, 'sawtooth', 0.35); noise(0.15, 0.2); },
      over: () => { [523, 392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.16, 'square', 0.3, 0.1 + i * 0.16)); tone(131, 98, 0.5, 'triangle', 0.4, 0.75); },
      record: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, f, 0.1, 'square', 0.28, 0.9 + i * 0.09)); },
      select: () => tone(660, 880, 0.06, 'square', 0.25),
    };
  })();

  // ---------- 角色圖（沿用辦公室走路圖：64×64 格；列 0 正面、1 左、2 右） ----------
  function loadSheets() {
    for (const c of CHARS) {
      if (sheets[c.id]) continue;
      const img = new Image(), rec = { img, pad: 4, ok: false };
      sheets[c.id] = rec;
      img.onload = () => {
        rec.ok = img.naturalWidth >= CELL * 3 && img.naturalHeight >= CELL * 3;
        try {   // 找出正面站姿的腳底，讓角色站在平台上不浮空
          const cv = document.createElement('canvas'); cv.width = CELL; cv.height = CELL;
          const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, CELL, CELL, 0, 0, CELL, CELL);
          const d = cx.getImageData(0, 0, CELL, CELL).data;
          for (let y = CELL - 1; y >= 0; y--) { let hit = false; for (let x = 0; x < CELL; x++) if (d[(y * CELL + x) * 4 + 3] > 40) { hit = true; break; } if (hit) { rec.pad = CELL - 1 - y; break; } }
        } catch (e) { /* 讀不到像素就用預設值 */ }
      };
      img.onerror = () => { rec.ok = false; };
      img.src = `assets/characters/${c.id}-walk.png`;
    }
  }

  // ---------- 繪圖工具（邏輯座標 → 畫布整數像素） ----------
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
  const mix = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) + ((((pb >> s) & 255) - ((pa >> s) & 255)) * t));
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  };

  // ---------- 關卡生成（間距與機率曲線依量化分析師的設計） ----------
  function typeWeights(f) {
    if (f < 4) return { normal: 0.88, spring: 0.12, moving: 0, fragile: 0 };
    if (f < 12) return { normal: 0.62, spring: 0.14, moving: 0.16, fragile: 0.08 };
    return { normal: 0.44, spring: 0.14, moving: 0.25, fragile: 0.17 };
  }
  // 可達性保證（依 OpenAI 審查）：相鄰兩台的水平距離 ≤ MAX_DX（加上移動台巡邏範圍也不超過 REACH），
  // 一般跳在空中約 0.6 秒、全速可走約 80 px，所以從台面任何位置起跳都追得到下一台；警報雲放在環狀對面，不擋主路線。
  const MAX_DX = 54, REACH = 66;
  function makePlatform(y, prev) {
    const f = floorAt(y), wts = typeWeights(f);
    let r = rnd(), type = 'normal';
    for (const t of ['normal', 'spring', 'moving', 'fragile']) { r -= wts[t]; if (r <= 0) { type = t; break; } }
    if (prev && prev.type === 'fragile' && type === 'fragile') type = 'normal';   // 不連續兩片易碎台
    const px = prev ? (prev.home != null ? prev.home : prev.x) : 90;
    const spread = Math.min(MAX_DX, 30 + f * 2.5);            // 前期水平移動小、後期拉大
    const toward = (90 - px) * 0.25;                          // 輕微往中間拉，避免一直貼邊
    let x = clamp(px + toward + (rnd() * 2 - 1) * spread, PW / 2 + 2, W - PW / 2 - 2);
    if (Math.abs(x - px) > MAX_DX) x = px + Math.sign(x - px) * MAX_DX;
    const p = { x, home: x, y, type, w: PW, broken: false, springT: 0, fallY: 0, fallVy: 0 };
    if (type === 'moving') {
      p.range = Math.max(8, Math.min(30, 14 + f * 0.8, REACH - Math.abs(x - px)));
      p.home = clamp(x, PW / 2 + 2 + p.range, W - PW / 2 - 2 - p.range);
      if (Math.abs(p.home - px) + p.range > REACH) p.home = px + Math.sign(p.home - px) * (REACH - p.range);
      p.x = p.home; p.vx = (rnd() < 0.5 ? -1 : 1) * Math.min(52, 22 + 1.5 * f);
    }
    if (type === 'normal' || type === 'moving') {
      const roll = rnd();
      if (roll < 0.11 && f >= 1) g.items.push({ type: 'coffee', plat: p, x: p.x, y: y - 11, t: rnd() * 6 });
      else if (roll < 0.15 && f >= 2) g.items.push({ type: 'star', plat: p, x: p.x, y: y - 12, t: rnd() * 6 });
    }
    const risk = f < 8 ? 0 : Math.min(0.18, 0.045 + 0.006 * (f - 8));
    if (rnd() < risk) {
      const cx = wrap(p.home + W / 2);   // 環狀對面：距離這台與下一台都 ≥ 36 px
      g.clouds.push({ x: cx, home: cx, y: y - 26, vx: (rnd() < 0.5 ? -1 : 1) * Math.min(48, 26 + f * 0.6), range: 12, t: rnd() * 6, dead: false, deadT: 0 });
    }
    return p;
  }
  function fillAbove() {
    let top = g.plats[g.plats.length - 1];
    while (top.y > g.cam - 160) {
      const f = floorAt(top.y), lo = Math.min(40, 24 + 0.7 * f), hi = Math.min(62, 38 + 1.2 * f);
      const p = makePlatform(top.y - (lo + rnd() * (hi - lo)), top);
      g.plats.push(p); top = p;
    }
  }
  function cull() {
    const lim = g.cam + H + 60;
    g.plats = g.plats.filter((p, i) => p.y < lim || i === g.plats.length - 1);
    g.items = g.items.filter(it => it.y < lim);
    g.clouds = g.clouds.filter(c => c.y < lim && !(c.dead && c.deadT > 0.6));
  }

  function newGame(demo) {
    g = {
      demo: !!demo, x: 90, y: BASE, vx: 0, vy: P.jump, cam: 0, height: 0, bonus: 0, score: 0, floor: 0,
      plats: [{ x: 90, home: 90, y: BASE, type: 'normal', w: PW + 16, broken: false, springT: 0, start: true }],
      items: [], clouds: [], parts: [], pops: [], t: 0, squash: 0, face: 0, caffeine: 0, phase: rnd() * 6.28, dieT: 0, newRecord: false,
    };
    if (!demo) fillAbove();
  }

  // ---------- 物理（固定 240Hz 子步，與螢幕更新率無關） ----------
  function axis() {
    let a = (keys.right || touch.right ? 1 : 0) - (keys.left || touch.left ? 1 : 0);
    if (!a && drag.on) { const d = wrap(drag.x - g.x + W / 2) - W / 2; if (Math.abs(d) > 4) a = Math.sign(d) * Math.min(1, Math.abs(d) / 14); }
    return a;
  }
  function patrol(o, h) {
    o.x += o.vx * h;
    if (o.x > o.home + o.range) { o.x = o.home + o.range; o.vx = -Math.abs(o.vx); }
    if (o.x < o.home - o.range) { o.x = o.home - o.range; o.vx = Math.abs(o.vx); }
  }
  function puff(x, y, n, c) { if (g.parts.length > 120) g.parts.splice(0, n); for (let i = 0; i < n; i++) g.parts.push({ x: x + (rnd() - 0.5) * 14, y, vx: (rnd() - 0.5) * 60, vy: -rnd() * 50, life: 0.35 + rnd() * 0.25, c }); }
  function pop(x, y, str, c) { g.pops.push({ x, y, str, c: c || '#ffe08a', t: 0 }); }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, P.dtClamp);
    g.t += dt;
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;   // 每個子步最長 1/240 秒
    const dying = () => mode === 'dying';
    let ax = g.demo ? 0 : axis();
    const maxVx = P.maxVx * (g.caffeine > 0 ? 1.25 : 1);
    for (let i = 0; i < n; i++) {
      const oldY = g.y;
      if (dying()) ax = 0;
      if (!dying()) {
        g.vx = ax ? clamp(g.vx + ax * P.accel * h, -maxVx, maxVx) : g.vx * Math.exp(-P.friction * h);
        g.x = wrap(g.x + g.vx * h);
      }
      const v0 = g.vy; g.vy = Math.min(P.maxFall, g.vy + P.gravity * h);
      g.y += (v0 + g.vy) * h / 2;
      for (const p of g.plats) if (p.type === 'moving' && !p.broken) patrol(p, h);
      for (const c of g.clouds) if (!c.dead) patrol(c, h);
      if (dying()) continue;
      // 落下時腳底穿過平台頂面 → 彈跳；同一子步落地就不再判雲（避免落地改寫速度後誤判撞雲）
      let landed = false;
      if (g.vy > 0) {
        let hit = null;
        for (const p of g.plats) {
          if (p.broken || oldY > p.y || g.y < p.y) continue;
          if (wdist(g.x, p.x) <= FEET + p.w / 2 && (!hit || p.y < hit.y)) hit = p;
        }
        if (hit) { land(hit); landed = true; }
      }
      // 紅色額度警報雲：腳底從雲頂上方落下 = 踩爆；其他方向 = 出局
      if (!landed) for (const c of g.clouds) {
        if (c.dead) continue;
        if (wdist(g.x, c.x) < 8 + 9 && g.y > c.y - 6 && g.y - BODY < c.y + 5) {
          if (g.vy > 0 && oldY <= c.y - 5) {
            c.dead = true; g.y = c.y - 6; g.vy = P.jump; g.bonus += STOMP_PTS; g.squash = 1;
            pop(c.x, c.y - 10, `+${STOMP_PTS} 踩爆！`, '#ff9d9d'); puff(c.x, c.y, 10, '#ff5f57'); Sfx.stomp();
          } else { die(); break; }
        }
      }
      if (dying()) continue;
      // 道具（位置直接讀平台當下座標，跟著移動台走）
      for (const it of g.items) {
        if (it.got) continue;
        it.x = it.plat.x;
        if (wdist(g.x, it.x) < 8 + 5 && g.y > it.y - 6 && g.y - BODY < it.y + 6) {
          it.got = true;
          if (it.type === 'coffee') { g.bonus += 50; g.caffeine = 3; pop(it.x, it.y - 8, '+50 ☕ 加速！', '#ffd9a0'); Sfx.coffee(); }
          else { g.bonus += 100; pop(it.x, it.y - 8, '+100 ★', '#ffe08a'); puff(it.x, it.y, 8, '#ffe08a'); Sfx.star(); }
        }
      }
    }
    g.items = g.items.filter(it => !it.got);
    for (const it of g.items) { it.x = it.plat.x; it.t += dt; }
    for (const c of g.clouds) { c.t += dt; if (c.dead) c.deadT += dt; }
    for (const p of g.plats) {
      if (p.springT > 0) p.springT = Math.max(0, p.springT - dt);
      if (p.broken) { p.fallVy += 500 * dt; p.fallY += p.fallVy * dt; }
    }
    for (const q of g.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 200 * dt; q.life -= dt; }
    g.parts = g.parts.filter(q => q.life > 0);
    for (const q of g.pops) q.t += dt;
    g.pops = g.pops.filter(q => q.t < 1);
    g.squash = Math.max(0, g.squash - dt * 6);
    g.caffeine = Math.max(0, g.caffeine - dt);
    if (Math.abs(g.vx) > 20) g.face = g.vx < 0 ? -1 : 1; else if (Math.abs(g.vx) < 6) g.face = 0;
    if (g.demo) return;
    if (!dying()) {
      g.height = Math.max(g.height, BASE - g.y);
      g.score = Math.floor(g.height) + g.bonus;
      const f = Math.floor(g.height / 100);
      if (f > g.floor) { g.floor = f; if (f % 10 === 0) { pop(g.x, g.y - 40, `${f}F 達成！`, '#9ef0c8'); Sfx.floor(); } }
      g.cam = Math.min(g.cam, g.y - CAM_LEAD);
      fillAbove(); cull();
    }
    if (g.y - BODY > g.cam + H + 10) gameOver();
  }
  function land(p) {
    g.y = p.y; g.squash = 1;
    if (p.type === 'spring') { g.vy = P.spring; p.springT = 0.3; Sfx.spring(); puff(p.x, p.y, 6, '#ffe08a'); }
    else { g.vy = P.jump; Sfx.jump(); puff(g.x, p.y, 4, '#e8f4ff'); }
    if (p.type === 'fragile') { p.broken = true; p.fallVy = 30; Sfx.crack(); puff(p.x, p.y, 8, '#d8b98a'); }
  }
  function die() {
    if (mode !== 'play') return;
    mode = 'dying'; g.vy = -260; g.vx = 0; g.dieT = 0; Sfx.hurt();
    pop(g.x, g.y - 34, '額度警報！', '#ff9d9d');
  }
  function gameOver() {
    if (g.demo) { newGame(true); return; }
    mode = 'over';
    g.newRecord = g.score > best;
    if (g.newRecord) { best = g.score; store.set(KEY_BEST, best); }
    Sfx.over(); if (g.newRecord) Sfx.record();
    showOverlay('over');
  }

  // ---------- 繪製 ----------
  function sky() {
    const f = g.demo ? 0 : g.cam < 0 ? -g.cam / 100 : 0;
    const stops = [[0, '#9fdcf0', '#d6f2ea'], [10, '#7fb6ea', '#cfe6f7'], [22, '#f4a46a', '#ffd9a0'], [34, '#4a3d7a', '#c86b8a'], [48, '#141a3a', '#2c2f63']];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) if (f >= stops[i][0] && f < stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    const t = f >= stops[stops.length - 1][0] ? 1 : clamp((f - a[0]) / (b[0] - a[0]), 0, 1);
    const top = f >= stops[stops.length - 1][0] ? b[1] : mix(a[1], b[1], t), bot = f >= stops[stops.length - 1][0] ? b[2] : mix(a[2], b[2], t);
    for (let i = 0; i < 10; i++) R(0, i * 32, W, 33, mix(top, bot, i / 9));
    if (f > 28) {   // 夜空星星
      const al = clamp((f - 28) / 10, 0, 1);
      for (let i = 0; i < 26; i++) { const sx = hash(i) * W, sy = ((hash(i + 50) * 400 - g.cam * 0.05) % 360 + 360) % 360 - 20; if ((Math.floor(g.t * 2 + i) % 7) || al < 0.5) R(sx, sy, 1, 1, al > 0.5 ? '#fff7c2' : '#c9d0e6'); }
    }
    // 視差雲朵
    for (let i = 0; i < 6; i++) {
      const cy = ((hash(i + 9) * 420 - g.cam * 0.25) % 420 + 420) % 420 - 50;
      const cx = (hash(i + 3) * (W + 60) + g.t * (4 + i)) % (W + 60) - 40;
      const c = f > 30 ? 'rgba(200,210,255,.18)' : 'rgba(255,255,255,.55)';
      R(cx, cy, 30, 6, c); R(cx + 6, cy - 4, 16, 4, c); R(cx + 22, cy - 2, 10, 3, c);
    }
    // 起點：辦公室剪影 + 沼澤
    const gy = BASE + 8 - g.cam, oy = BASE - 6 - g.cam * 0.6;   // 遠景樓房：視差捲動得比較慢
    if (oy - 95 < H) for (let i = 0; i < 7; i++) {
      const bw = 18 + hash(i) * 14, bh = 30 + hash(i + 20) * 60, bx = i * 27 - 6;
      R(bx, oy - bh, bw, H, '#5f7fa8');
      for (let row = 0, wy = oy - bh + 5; wy < oy - 4; row++, wy += 8)
        for (let col = 0, wx = bx + 3; wx < bx + bw - 3; col++, wx += 6) if (wy > -6 && wy < H) R(wx, wy, 3, 4, hash(i * 256 + row * 8 + col) > 0.35 ? '#ffe9a8' : '#4a6890');
    }
    if (gy < H + 40) {
      R(0, gy, W, H, '#3f8f6a'); R(0, gy, W, 3, '#5fbf7a');
      for (let x = 0; x < W; x += 9) R(x + 2, gy - 4 - (x % 4), 1, 4 + (x % 4), '#2e7d4f');
      R(0, gy + 10, W, H, '#3b7fa8');
      for (let x = (g.t * 10) % 16 - 16; x < W; x += 16) R(x, gy + 12, 7, 1, '#7fc6e8');
    }
  }
  function floorMarks() {
    const f0 = Math.max(1, floorAt(g.cam + H + 20)), f1 = floorAt(g.cam - 20);
    for (let f = f0; f <= f1; f++) {
      const y = BASE - f * 100 - g.cam;
      for (let x = 0; x < W; x += 8) R(x, y, 4, 1, 'rgba(255,255,255,.22)');
      text(`${f}F`, 4, y - 5, 6, 'rgba(255,255,255,.75)', 'left', 'rgba(10,13,24,.45)');
    }
  }
  function platform(p) {
    const sy = p.y - g.cam + (p.broken ? p.fallY : 0);
    if (sy < -20 || sy > H + 20) return;
    const x0 = p.x - p.w / 2, w = p.w;
    const pieces = p.x - p.w / 2 < 0 || p.x + p.w / 2 > W ? [x0, x0 + (p.x < W / 2 ? W : -W)] : [x0];
    for (const xx of pieces) {
      if (p.type === 'fragile') {
        if (p.broken) {
          const gap = Math.min(10, p.fallY * 0.25);
          R(xx - gap, sy, w / 2 - 1, 5, '#c9a46e'); R(xx + w / 2 + 1 + gap, sy + 2, w / 2 - 1, 5, '#c9a46e');
        } else {
          R(xx, sy, w, 6, '#a9824f'); R(xx + 1, sy, w - 2, 2, '#e6c995');
          R(xx + 9, sy + 2, 1, 3, '#6d4f28'); R(xx + 10, sy + 1, 1, 2, '#6d4f28'); R(xx + 24, sy + 2, 1, 3, '#6d4f28'); R(xx + 25, sy + 3, 2, 1, '#6d4f28');
        }
      } else if (p.type === 'moving') {
        R(xx, sy, w, 6, '#3d5fb0'); R(xx + 1, sy, w - 2, 2, '#9fc3ff'); R(xx + 1, sy + 5, w - 2, 1, '#263c73');
        R(xx + 3, sy + 3, 2, 1, '#ffe08a'); R(xx + 2, sy + 2, 1, 3, '#ffe08a'); R(xx + w - 5, sy + 3, 2, 1, '#ffe08a'); R(xx + w - 3, sy + 2, 1, 3, '#ffe08a');
      } else {
        const start = p.start;
        R(xx, sy, w, 6, start ? '#6b4423' : '#7a4a22'); R(xx + 1, sy + 1, w - 2, 3, '#a46b37');
        R(xx, sy - 1, w, 3, '#4cbf5a'); R(xx + 1, sy - 1, w - 2, 1, '#7fe08c');
        for (let i = 3; i < w - 2; i += 7) R(xx + i, sy + 2, 2, 2 + ((i / 7) % 2), '#3e9a48');
        R(xx + 1, sy + 5, w - 2, 1, '#5e3818');
        if (p.type === 'spring') {
          const cx = Math.round(xx + w / 2), ext = p.springT > 0 ? 5 : 0;
          for (let i = 0; i < 3 + (ext ? 2 : 0); i++) R(cx - 3, sy - 2 - i * 2, 6, 1, i % 2 ? '#8d96b3' : '#e8ecf5');
          R(cx - 5, sy - 5 - ext - (ext ? 3 : 0), 10, 2, '#ff5f57'); R(cx - 4, sy - 6 - ext - (ext ? 3 : 0), 8, 1, '#ff9d9d');
        }
      }
    }
  }
  function item(it) {
    const sy = it.y - g.cam + Math.round(Math.sin(it.t * 4) * 1.5);
    if (sy < -20 || sy > H + 20) return;
    const x = Math.round(it.x);
    if (it.type === 'coffee') {
      R(x - 4, sy - 3, 7, 7, '#ffffff'); R(x - 4, sy - 3, 7, 2, '#6b3d1e'); R(x + 3, sy - 1, 2, 3, '#ffffff'); R(x + 4, sy, 1, 1, '#c9d0e6');
      R(x - 4, sy + 3, 7, 1, '#c9d0e6'); R(x - 2, sy, 3, 2, '#e85d4a');
      const st = Math.floor(it.t * 3) % 2; R(x - 2 + st, sy - 6, 1, 2, 'rgba(255,255,255,.8)'); R(x + 1 - st, sy - 8, 1, 2, 'rgba(255,255,255,.6)');
    } else {
      const c = Math.floor(it.t * 5) % 2 ? '#ffe08a' : '#ffd65a';
      R(x - 1, sy - 5, 2, 3, c); R(x - 5, sy - 2, 10, 2, c); R(x - 3, sy, 6, 2, c); R(x - 4, sy + 2, 3, 2, c); R(x + 1, sy + 2, 3, 2, c);
      R(x - 1, sy - 2, 1, 1, '#fff7c2'); R(x - 2, sy - 1, 1, 1, '#b8860b'); R(x + 1, sy - 1, 1, 1, '#b8860b');
    }
  }
  function cloud(c) {
    const sy = c.y - g.cam;
    if (sy < -20 || sy > H + 20) return;
    const x = Math.round(c.x), bob = Math.round(Math.sin(c.t * 3) * 1);
    if (c.dead) { const s = 1 + c.deadT * 8; R(x - 9 * s / 2, sy - 2, 9 * s, 2, 'rgba(255,95,87,.5)'); return; }
    const y = sy + bob, flash = Math.floor(c.t * 4) % 2;
    R(x - 9, y - 4, 18, 8, '#e0443b'); R(x - 6, y - 7, 12, 4, '#ff5f57'); R(x - 10, y - 2, 20, 5, '#ff5f57'); R(x - 7, y + 3, 14, 2, '#b8322b');
    R(x - 5, y - 1, 2, 2, '#1a1a2a'); R(x + 3, y - 1, 2, 2, '#1a1a2a'); R(x - 6, y - 3, 3, 1, '#7a1a16'); R(x + 3, y - 3, 3, 1, '#7a1a16');
    R(x - 2, y + 2, 4, 1, '#7a1a16');
    if (flash) { R(x - 1, y - 14, 2, 4, '#ffe08a'); R(x - 1, y - 9, 2, 1, '#ffe08a'); }
    R(x - 13 + flash, y + 5, 2, 2, '#ffd65a'); R(x + 11 - flash, y + 6, 2, 2, '#ffd65a');
  }
  function player(dxOff) {
    const c = CHARS[charIdx], rec = sheets[c.id];
    const x = g.x + dxOff, feet = g.y - g.cam;
    let sx = 1, sy = 1;
    if (g.squash > 0) { sx = 1 + 0.28 * g.squash; sy = 1 - 0.24 * g.squash; }
    else if (g.vy < 0) { const st = clamp(-g.vy / P.spring, 0, 1) * 0.14; sx = 1 - st * 0.6; sy = 1 + st; }
    if (mode === 'dying') { sx = 1; sy = 1; }
    if (g.caffeine > 0 && Math.floor(g.t * 10) % 2) R(x - 10, feet - 30, 1, 1, '#ffd9a0');
    if (rec && rec.ok) {
      const row = mode === 'dying' ? 3 : g.face < 0 ? 1 : g.face > 0 ? 2 : 0;
      const col = g.face !== 0 && mode !== 'dying' ? 1 + (Math.floor(g.t * 8) % 2) : 0;
      const dw = Math.round(SPR * sx * k), dh = Math.round(SPR * sy * k);
      const footPx = (CELL - rec.pad) / CELL * SPR * sy;
      const dx = Math.round(x * k - dw / 2), dy = Math.round((feet - footPx) * k);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rec.img, col * CELL, row * CELL, CELL, CELL, dx, dy, dw, dh);
    } else {   // 圖檔還沒載入：畫程序化沼王
      const bw = 16 * sx, bh = 20 * sy, top = feet - bh;
      R(x - bw / 2, top + 4, bw, bh - 4, c.color); R(x - bw / 2 + 2, top, bw - 4, 6, c.color);
      R(x - 4, top + 6, 2, 2, '#1a1a2a'); R(x + 2, top + 6, 2, 2, '#1a1a2a'); R(x - 3, top + 10, 6, 1, '#1a1a2a');
      R(x - bw / 2 - 2, top + 3, 2, 4, c.accent); R(x + bw / 2, top + 3, 2, 4, c.accent);
    }
  }
  function render() {
    ctx.imageSmoothingEnabled = false;
    sky();
    if (!g.demo) floorMarks();
    for (const p of g.plats) platform(p);
    for (const it of g.items) item(it);
    for (const c of g.clouds) cloud(c);
    for (let i = Math.max(0, g.parts.length - 48); i < g.parts.length; i++) {   // 只畫最新 48 顆、畫面外略過
      const q = g.parts[i], x = Math.round(q.x), y = Math.round(q.y - g.cam);
      if (y < -2 || y >= H || x < -2 || x >= W) continue;
      const sz = i % 3 ? 2 : 1; R(x, y, sz, sz, q.c);
    }
    player(0);
    if (g.x < 16) player(W); else if (g.x > W - 16) player(-W);   // 左右穿越時兩側都畫
    for (const q of g.pops) text(q.str, q.x, q.y - g.cam - q.t * 22, 7, q.c, 'center', 'rgba(10,13,24,.75)');
    if (!g.demo) updateHud();
  }
  let hudSig = '';
  function updateHud() {
    const sig = g.score + '|' + g.floor + '|' + best + '|' + (g.caffeine > 0);
    if (sig === hudSig) return; hudSig = sig;
    hud.score.textContent = g.score.toLocaleString('en-US');
    hud.floor.textContent = g.floor + 'F';
    hud.best.textContent = Math.max(best, g.score).toLocaleString('en-US');
    hud.boost.hidden = !(g.caffeine > 0);
  }

  // ---------- 迴圈：只有視窗開著才跑；關閉後完全停止（0 CPU） ----------
  // 只有遊玩中、死亡動畫、標題示範會排下一幀；暫停／結算畫面凍結不重畫（OpenAI 建議）
  const animating = () => open && !document.hidden && !!g && (mode === 'play' || mode === 'dying' || (mode === 'title' && g.demo));
  function frame(now) {
    rafId = 0;
    if (!animating()) return;
    const dt = clamp((now - last) / 1000, 0, P.dtClamp); last = now;
    step(dt);
    if (open && !document.hidden) render();
    if (!rafId && animating()) rafId = requestAnimationFrame(frame);
  }
  function startLoop() { if (!rafId && animating()) { last = performance.now(); rafId = requestAnimationFrame(frame); } else if (g && open && !rafId) render(); }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  // ---------- 畫面切換 ----------
  function showOverlay(which) {
    for (const [name, el] of Object.entries(ui.ov)) el.hidden = name !== which;
    hud.bar.hidden = which === 'title';
    if (which === 'over') {
      ui.ovScore.textContent = g.score.toLocaleString('en-US');
      ui.ovFloor.textContent = g.floor + 'F';
      ui.ovBest.textContent = best.toLocaleString('en-US');
      ui.ovRecord.hidden = !g.newRecord;
    }
    if (which === 'title') renderChars();
    const target = { title: ui.startBtn, over: ui.again, paused: ui.resumeBtn }[which];
    if (target && open && !document.hidden) target.focus({ preventScroll: true });
  }
  function startGame() {
    Sfx.ensure();
    clearInput();
    newGame(false); hudSig = ''; mode = 'play';
    showOverlay(null);
    canvas.focus({ preventScroll: true });
    startLoop();
  }
  function toTitle() { mode = 'title'; newGame(true); showOverlay('title'); startLoop(); }
  function pause() { if (mode === 'play') { mode = 'paused'; stopLoop(); clearInput(); showOverlay('paused'); } }
  function resume() { if (mode === 'paused') { Sfx.ensure(); mode = 'play'; showOverlay(null); canvas.focus({ preventScroll: true }); last = performance.now(); startLoop(); } }
  function clearInput() { keys.left = keys.right = touch.left = touch.right = false; drag.on = false; ui.btnL && ui.btnL.classList.remove('on'); ui.btnR && ui.btnR.classList.remove('on'); }

  function renderChars() {
    ui.chars.innerHTML = '';
    CHARS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'qj-char' + (i === charIdx ? ' on' : '') + (c.bonus ? ' bonus' : '');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(i === charIdx));
      b.style.setProperty('--c', c.color);
      b.innerHTML = `<img src="assets/characters/${c.id}-avatar.png" alt="" width="40" height="40"><b>${c.name}</b><small>${c.bonus ? '★ ' : ''}${c.tag}</small>`;
      b.addEventListener('click', () => { charIdx = i; store.set(KEY_CHAR, i); Sfx.ensure(); Sfx.select(); renderChars(); ui.startBtn.focus({ preventScroll: true }); });
      ui.chars.appendChild(b);
    });
    ui.startName.textContent = CHARS[charIdx].name;
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
    if (!modal) return;
    if (open) return;
    opener = from || document.activeElement;
    open = true; modal.hidden = false; document.body.classList.add('qj-open');
    loadSheets();
    if (window.Office) window.Office.setActive(false);   // 遊戲開著時辦公室地圖暫停，省電
    if (!ro) { ro = new ResizeObserver(resize); }
    ro.observe(canvas); resize();
    if (mode === 'play') mode = 'paused';
    if (!g || mode === 'title') toTitle();
    else { showOverlay(mode === 'over' ? 'over' : 'paused'); render(); }
    startLoop();
  }
  function closeGame() {
    if (!open) return;
    if (mode === 'play' || mode === 'dying') { if (mode === 'dying') gameOver(); else mode = 'paused'; }
    open = false; modal.hidden = true; document.body.classList.remove('qj-open');
    stopLoop(); clearInput();
    if (ro) ro.disconnect();
    if (window.Office) window.Office.setActive(!document.hidden);
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  }

  // ---------- 輸入 ----------
  const isLeft = e => e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
  const isRight = e => e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';
  function onKeyDown(e) {
    if (!open || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') { trapFocus(e); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) closeGame(); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.repeat) { e.preventDefault(); return; }                       // 長按不會連開好幾局
      if (e.target && e.target.closest && e.target.closest('button')) return;   // 焦點在按鈕上：交給按鈕原生 click
      e.preventDefault();
      if (mode === 'title' || mode === 'over') startGame(); else if (mode === 'paused') resume();
      return;
    }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (!e.repeat) { if (mode === 'play') pause(); else if (mode === 'paused') resume(); } return; }
    if (isLeft(e)) keys.left = true; else if (isRight(e)) keys.right = true;
    else if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
  }
  function onKeyUp(e) {
    if (isLeft(e)) keys.left = false;
    if (isRight(e)) keys.right = false;
  }
  function trapFocus(e) {
    const f = [...modal.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter(el => !el.closest('[hidden]') && el.getClientRects().length);
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus({ preventScroll: true }); }
  }
  function canvasX(e) { const r = canvas.getBoundingClientRect(); return (e.clientX - r.left) / r.width * W; }
  function holdBtn(btn, side) {   // 一顆按鈕只認第一根按下的手指，別的手指放開不會誤解除
    let owner = null;
    const on = e => {
      e.preventDefault();
      if (!open || mode !== 'play' || owner != null) return;
      owner = e.pointerId; touch[side] = true; drag.on = false; btn.classList.add('on');
      try { btn.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    };
    const off = e => { if (owner != null && e.pointerId !== owner) return; owner = null; touch[side] = false; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, off));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }

  function init() {
    modal = document.getElementById('qjModal'); if (!modal) return;
    canvas = document.getElementById('qjCanvas'); ctx = canvas.getContext('2d', { alpha: false });
    const $ = s => modal.querySelector(s);
    hud = { bar: $('.qj-hud'), score: $('#qjScore'), floor: $('#qjFloor'), best: $('#qjBest'), boost: $('#qjBoost') };
    ui = {
      ov: { title: $('#qjTitle'), over: $('#qjOver'), paused: $('#qjPaused') },
      chars: $('#qjChars'), startBtn: $('#qjStart'), startName: $('#qjStartName'),
      ovScore: $('#qjOvScore'), ovFloor: $('#qjOvFloor'), ovBest: $('#qjOvBest'), ovRecord: $('#qjOvRecord'),
      again: $('#qjAgain'), resumeBtn: $('#qjResume'), mute: $('#qjMute'), btnL: $('#qjLeft'), btnR: $('#qjRight'),
    };
    ui.startBtn.addEventListener('click', startGame);
    ui.again.addEventListener('click', startGame);
    $('#qjChange').addEventListener('click', toTitle);
    ui.resumeBtn.addEventListener('click', resume);
    $('#qjRestart').addEventListener('click', startGame);
    $('#qjClose').addEventListener('click', closeGame);
    modal.addEventListener('pointerdown', e => { if (e.target === modal && e.pointerType === 'mouse') closeGame(); });   // 觸控不靠點背景關閉，避免誤觸
    ui.mute.addEventListener('click', () => { muted = !muted; store.set(KEY_MUTE, muted ? '1' : '0'); syncMute(); if (!muted) { Sfx.ensure(); Sfx.select(); } });
    syncMute();
    holdBtn(ui.btnL, 'left'); holdBtn(ui.btnR, 'right');
    // 拖曳：相對位移（手指移多少、角色目標就移多少），第一根手指取得控制
    canvas.addEventListener('pointerdown', e => {
      if (mode !== 'play' || drag.on || touch.left || touch.right || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag.on = true; drag.id = e.pointerId; drag.f0 = canvasX(e); drag.p0 = g.x; drag.x = g.x;
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => { if (drag.on && e.pointerId === drag.id) drag.x = wrap(drag.p0 + canvasX(e) - drag.f0); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => canvas.addEventListener(ev, e => { if (e.pointerId === drag.id) drag.on = false; }));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => { clearInput(); if (open) pause(); });   // 切走視窗就暫停，不會在看不到時摔死
    document.addEventListener('visibilitychange', () => {
      if (!open) return;
      if (document.hidden) { clearInput(); pause(); stopLoop(); } else { resize(); startLoop(); }
    });
    hud.best.textContent = best.toLocaleString('en-US');
  }

  window.QuagsireJump = {
    open: openGame, close: closeGame, isOpen: () => open,
    __forceFall: () => { if (g && mode === 'play') { g.plats.forEach(p => { p.broken = true; }); } },   // 測試用：讓角色掉下去
    debug: () => g && { mode, x: +g.x.toFixed(1), y: +g.y.toFixed(1), vx: +g.vx.toFixed(1), vy: +g.vy.toFixed(1), score: g.score, floor: g.floor, height: Math.floor(g.height), plats: g.plats.length, running: !!rafId, best, char: CHARS[charIdx].name, k: +k.toFixed(2),
      next: (() => { const up = g.plats.filter(p => !p.broken && p.y < g.y - 8 && p.y > g.y - 70).sort((a, b) => b.y - a.y)[0]; return up ? +up.x.toFixed(1) : null; })(),
      maxDx: (() => { let m = 0; for (let i = 2; i < g.plats.length; i++) m = Math.max(m, Math.abs((g.plats[i].home ?? g.plats[i].x) - (g.plats[i - 1].home ?? g.plats[i - 1].x)) + (g.plats[i].range || 0)); return +m.toFixed(1); })() },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
