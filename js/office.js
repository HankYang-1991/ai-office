/* 辦公室引擎：格子地圖、尋路(BFS)、碰撞、Agent 狀態機、Canvas 繪製 */
(function () {
  const C = window.OFFICE_CONFIG, S = window.OfficeSprites;
  const T = C.tile, COLS = C.cols, ROWS = C.rows, WW = COLS * T, WH = ROWS * T;
  const WALK_SPEED = 3.4; // 格/秒
  const STATUS = {
    working: { label: '工作中', color: '#4cd964' },
    idle:    { label: '閒置',   color: '#a7b0c4' },
    meeting: { label: '開會中', color: '#f5a623' },
    walking: { label: '移動中', color: '#5ac8fa' },
  };
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- 格子 ----------
  const grid = [], floor = [], roomOf = [];
  for (let y = 0; y < ROWS; y++) { grid.push(new Array(COLS).fill(0)); floor.push(new Array(COLS).fill('hall')); roomOf.push(new Array(COLS).fill(null)); }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) grid[y][x] = 1;
  for (const r of C.rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      if (edge) grid[y][x] = 1; else { floor[y][x] = r.floor; roomOf[y][x] = r.id; }
    }
    for (const [x, y] of r.doors) { grid[y][x] = 0; floor[y][x] = 'door'; }
  }
  for (const f of C.furniture) if (f.blocking !== false)
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) grid[y][x] = 2;
  const walkable = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y][x] === 0;
  const hallTiles = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (floor[y][x] === 'hall' && walkable(x, y)) hallTiles.push([x, y]);

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function bfs(sx, sy, tx, ty, blocked) {
    if (sx === tx && sy === ty) return [];
    const prev = new Int32Array(COLS * ROWS).fill(-1);
    const start = sy * COLS + sx, target = ty * COLS + tx;
    const q = [start]; prev[start] = start;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi]; if (cur === target) break;
      const cx = cur % COLS, cy = (cur / COLS) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy; if (!walkable(nx, ny)) continue;
        const ni = ny * COLS + nx; if (prev[ni] !== -1) continue;
        if (blocked && blocked.has(ni) && ni !== target) continue;
        prev[ni] = cur; q.push(ni);
      }
    }
    if (prev[target] === -1) return null;
    const path = []; let c = target;
    while (c !== start) { path.push([c % COLS, (c / COLS) | 0]); c = prev[c]; }
    return path.reverse();
  }

  // ---------- 靜態地圖繪製 ----------
  const mapCanvas = document.createElement('canvas'); mapCanvas.width = WW; mapCanvas.height = WH;
  function R(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function drawFloor(m, x, y, type) {
    const px = x * T, py = y * T, odd = (x + y) % 2;
    switch (type) {
      case 'wood': R(m, px, py, T, T, '#a8703f'); for (let i = 0; i < 4; i++) R(m, px, py + i * 4 + 3, T, 1, '#8f5d32');
        R(m, px + ((y * 7) % 12), py + 3 - 3, 1, 3, '#8f5d32'); break;
      case 'carpet': R(m, px, py, T, T, '#6f7699'); if (odd) { R(m, px + 4, py + 4, 2, 2, '#7d84a8'); R(m, px + 11, py + 11, 2, 2, '#7d84a8'); } break;
      case 'tileBlue': R(m, px, py, T, T, odd ? '#bccada' : '#b2c1d2'); R(m, px, py, T, 1, '#a3b3c6'); R(m, px, py, 1, T, '#a3b3c6'); break;
      case 'tileGreen': R(m, px, py, T, T, odd ? '#bdd5c1' : '#b3cdb8'); R(m, px, py, T, 1, '#a2bfa8'); R(m, px, py, 1, T, '#a2bfa8'); break;
      case 'tileWarm': R(m, px, py, T, T, odd ? '#dccaa9' : '#d4c19f'); R(m, px, py, T, 1, '#c6b18c'); R(m, px, py, 1, T, '#c6b18c'); break;
      case 'door': R(m, px, py, T, T, '#9c9488'); R(m, px + 1, py + 1, T - 2, T - 2, '#b3aa9c'); break;
      default: R(m, px, py, T, T, odd ? '#c9c9cf' : '#c1c1c8'); R(m, px, py, T, 1, '#b5b5bd'); R(m, px, py, 1, T, '#b5b5bd');
    }
  }
  function drawWall(m, x, y) {
    const px = x * T, py = y * T;
    R(m, px, py, T, T, '#363a4c'); R(m, px, py, T, 1, '#4b5068');
    const below = y + 1 < ROWS && grid[y + 1][x] !== 1;
    if (below) { R(m, px, py + 6, T, 10, '#e2ddd0'); R(m, px, py + 6, T, 1, '#f3efe4'); R(m, px, py + 15, T, 1, '#aea795'); }
  }
  function drawFurniture(m, f) {
    const px = f.x * T, py = f.y * T, w = f.w * T, h = f.h * T;
    switch (f.type) {
      case 'desk': {
        R(m, px, py + 2, w, h - 2, '#7a4a22'); R(m, px + 1, py + 1, w - 2, h - 4, '#a46b37'); R(m, px + 1, py + 1, w - 2, 1, '#c08447');
        R(m, px + 1, py + h - 3, w - 2, 2, '#5e3818');
        const cx = px + w / 2;
        if (f.deco === 'pc' || f.deco === 'pc2') {
          const mons = f.deco === 'pc2' ? [cx - 10, cx + 1] : [cx - 5];
          for (const mx of mons) { R(m, mx, py - 5, 10, 8, '#1d2130'); R(m, mx + 1, py - 4, 8, 5, '#4fc3f7'); R(m, mx + 2, py - 3, 4, 1, '#d9f4ff'); R(m, mx + 4, py + 3, 2, 2, '#333'); }
          R(m, cx - 4, py + 7, 8, 2, '#e9e9ee'); R(m, px + 3, py + 4, 4, 3, '#f5f5f5'); R(m, px + 4, py + 5, 2, 1, '#6a3');
        } else if (f.deco === 'drafting') {
          R(m, cx - 8, py, 16, 10, '#f7f7f2'); for (let i = 0; i < 4; i++) R(m, cx - 6, py + 2 + i * 2, 10 - i * 2, 1, '#3d6fd8');
          R(m, cx + 3, py + 3, 3, 3, '#3d6fd8'); R(m, px + 2, py + 3, 4, 1, '#f1c40f');
        } else if (f.deco === 'drawing') {
          R(m, cx - 7, py + 1, 12, 9, '#222'); R(m, cx - 6, py + 2, 10, 7, '#fefefe'); R(m, cx - 5, py + 3, 3, 3, '#5a9fd6'); R(m, cx - 1, py + 4, 4, 1, '#333'); R(m, cx - 1, py + 6, 3, 1, '#333');
          R(m, cx + 7, py + 2, 1, 7, '#f1c40f'); R(m, px + 2, py + 2, 3, 3, '#e74c3c'); R(m, px + 2, py + 6, 3, 3, '#2ecc71');
        } else if (f.deco === 'camera') {
          R(m, cx - 4, py + 2, 9, 6, '#222'); R(m, cx - 1, py + 3, 4, 4, '#555'); R(m, cx, py + 4, 2, 2, '#7fd3ff'); R(m, cx - 4, py + 1, 3, 1, '#222');
          R(m, px + 3, py - 4, 9, 7, '#1d2130'); R(m, px + 4, py - 3, 7, 4, '#f6b26b');
        } else if (f.deco === 'piano') {
          R(m, px + 2, py + 1, w - 4, 8, '#222'); R(m, px + 3, py + 4, w - 6, 5, '#fafafa');
          for (let i = px + 4; i < px + w - 4; i += 3) R(m, i, py + 4, 1, 3, '#222');
          R(m, px + 4, py + 2, 2, 1, '#ff6b6b'); R(m, px + 8, py + 2, 2, 1, '#4cd964');
        } else if (f.deco === 'blueprint') {
          R(m, cx - 10, py, 20, 10, '#2a5caa'); R(m, cx - 9, py + 2, 6, 5, '#2a5caa'); m.strokeStyle = '#cfe3ff';
          R(m, cx - 9, py + 2, 7, 1, '#cfe3ff'); R(m, cx - 9, py + 2, 1, 6, '#cfe3ff'); R(m, cx - 3, py + 2, 1, 6, '#cfe3ff'); R(m, cx - 9, py + 7, 7, 1, '#cfe3ff');
          R(m, cx + 1, py + 3, 7, 1, '#cfe3ff'); R(m, cx + 1, py + 5, 5, 1, '#cfe3ff'); R(m, cx + 1, py + 7, 6, 1, '#cfe3ff');
        }
        break; }
      case 'pool':
        R(m, px, py, w, h, '#6b3d1e'); R(m, px + 3, py + 3, w - 6, h - 6, '#1f8a4c'); R(m, px + 4, py + 4, w - 8, 1, '#27a35b');
        for (const [qx, qy] of [[px + 2, py + 2], [px + w / 2 - 1, py + 1], [px + w - 4, py + 2], [px + 2, py + h - 4], [px + w / 2 - 1, py + h - 3], [px + w - 4, py + h - 4]]) R(m, qx, qy, 2, 2, '#111');
        [['#fff', 12, 14], ['#e74c3c', 40, 12], ['#f1c40f', 43, 15], ['#3498db', 46, 12], ['#111', 44, 18]].forEach(([c, bx, by]) => R(m, px + bx, py + by, 2, 2, c));
        R(m, px + 14, py + 15, 20, 1, '#d9b38c'); break;
      case 'sofa':
        R(m, px, py, w, h, '#2f8f9d'); R(m, px, py, w, 5, '#246f7a'); R(m, px, py, 3, h, '#246f7a'); R(m, px + w - 3, py, 3, h, '#246f7a');
        for (let i = 1; i < f.w; i++) R(m, px + i * T, py + 6, 1, 8, '#246f7a'); break;
      case 'lowtable': R(m, px + 1, py + 3, w - 2, h - 5, '#7a4a22'); R(m, px + 2, py + 3, w - 4, h - 7, '#a46b37'); R(m, px + 8, py + 4, 4, 3, '#fff'); R(m, px + 18, py + 5, 3, 3, '#c0392b'); break;
      case 'plant': R(m, px + 4, py + 9, 8, 6, '#9b5a2a'); R(m, px + 4, py + 9, 8, 1, '#b86e36');
        R(m, px + 3, py + 2, 10, 7, '#2e8b3e'); R(m, px + 5, py, 6, 3, '#38a64a'); R(m, px + 2, py + 5, 3, 3, '#38a64a'); R(m, px + 11, py + 4, 3, 3, '#256f31'); break;
      case 'shelf': R(m, px + 1, py, w - 2, h, '#6b3d1e');
        for (let i = 0; i < 4; i++) { R(m, px + 2, py + 2 + i * 8, w - 4, 6, '#4a2a14'); ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6'].forEach((c, j) => R(m, px + 3 + j * 3, py + 3 + i * 8, 2, 5, c)); } break;
      case 'vending': R(m, px + 1, py - 6, w - 2, h + 6, '#c0392b'); R(m, px + 3, py - 4, 7, 12, '#9fd8f5'); R(m, px + 11, py - 2, 2, 6, '#333'); break;
      case 'coffee': R(m, px + 2, py - 2, w - 4, h + 1, '#5b5f6d'); R(m, px + 4, py, w - 8, 5, '#222'); R(m, px + 6, py + 8, 4, 4, '#fff'); R(m, px + 11, py, 2, 2, '#4cd964'); break;
      case 'rug': R(m, px, py, w, h, '#b5465a'); R(m, px + 2, py + 2, w - 4, h - 4, '#c95a6c'); R(m, px + 4, py + 4, w - 8, h - 8, '#b5465a'); break;
      case 'whiteboard': R(m, px, py - 8, w, 12, '#9aa0ab'); R(m, px + 1, py - 7, w - 2, 10, '#fbfbfb');
        R(m, px + 4, py - 5, 18, 1, '#3498db'); R(m, px + 4, py - 3, 26, 1, '#e74c3c'); R(m, px + 34, py - 6, 10, 6, '#f1c40f'); R(m, px + 4, py - 1, 14, 1, '#333'); break;
      case 'tv': R(m, px, py - 8, w, 12, '#1d2130'); R(m, px + 2, py - 6, w - 4, 8, '#3949ab'); R(m, px + 6, py - 4, 16, 2, '#9fa8da'); R(m, px + 6, py - 1, 10, 1, '#9fa8da'); break;
      case 'conftable': R(m, px, py, w, h, '#5e3818'); R(m, px + 2, py + 2, w - 4, h - 4, '#8b5a2b'); R(m, px + 4, py + 4, w - 8, 2, '#a46b37');
        for (let i = 0; i < 6; i++) { R(m, px + 14 + i * 16, py + 6, 6, 4, '#f5f5f5'); R(m, px + 14 + i * 16, py + h - 12, 6, 4, '#f5f5f5'); }
        R(m, px + w / 2 - 6, py + h / 2 - 3, 12, 6, '#2c3e50'); R(m, px + w / 2 - 4, py + h / 2 - 2, 8, 3, '#4fc3f7'); break;
      case 'bench': R(m, px, py + 2, w, h - 2, '#7f8c8d'); R(m, px + 1, py + 2, w - 2, 2, '#95a5a6');
        R(m, px + 3, py - 4, 14, 10, '#2c3e50'); R(m, px + 4, py - 3, 10, 6, '#0b3d1e');
        for (let i = 0; i < 10; i++) R(m, px + 4 + i, py - 1 + Math.round(Math.sin(i * 1.2) * 2), 1, 1, '#4cd964');
        R(m, px + 24, py + 4, 12, 6, '#f39c12'); R(m, px + 26, py + 5, 3, 3, '#222'); R(m, px + 31, py + 5, 3, 3, '#c0392b'); break;
      case 'printer': R(m, px + 1, py - 2, w - 2, h + 1, '#dfe4ea'); R(m, px + 3, py, w - 6, 3, '#57606f'); R(m, px + 6, py + 5, w - 12, 8, '#fff'); R(m, px + 8, py + 7, 12, 1, '#3d6fd8'); break;
      case 'cabinet': R(m, px, py - 4, w, h + 4, '#8395a7'); for (let i = 0; i < f.w; i++) { R(m, px + i * T + 2, py - 2, T - 4, 6, '#a4b0be'); R(m, px + i * T + 6, py, 4, 1, '#57606f'); R(m, px + i * T + 2, py + 6, T - 4, 6, '#a4b0be'); } break;
      case 'rack': R(m, px + 1, py - 6, w - 2, h + 6, '#1e222c'); for (let i = 0; i < 6; i++) { R(m, px + 3, py - 4 + i * 6, w - 6, 4, '#2f3542'); R(m, px + 4, py - 3 + i * 6, 1, 1, i % 2 ? '#4cd964' : '#ffa502'); } break;
      case 'easel': R(m, px + 3, py + 8, 1, 8, '#6b3d1e'); R(m, px + 12, py + 8, 1, 8, '#6b3d1e'); R(m, px + 1, py - 4, 14, 13, '#fff'); R(m, px + 3, py - 2, 10, 4, '#87ceeb'); R(m, px + 3, py + 2, 10, 5, '#5fa55a'); R(m, px + 9, py - 1, 3, 3, '#f1c40f'); break;
      case 'backdrop': R(m, px, py - 6, w, h + 6, '#e6e6ea'); R(m, px, py - 6, w, 3, '#9aa0ab'); R(m, px + w / 2 - 6, py + 6, 12, 8, '#f5f5f7');
        R(m, px - 2, py - 2, 6, 6, '#fff7c2'); R(m, px + w - 4, py - 2, 6, 6, '#fff7c2'); break;
      case 'tripod': R(m, px + 7, py + 2, 2, 10, '#333'); R(m, px + 4, py + 12, 2, 3, '#333'); R(m, px + 10, py + 12, 2, 3, '#333'); R(m, px + 4, py - 2, 8, 5, '#222'); R(m, px + 10, py - 1, 3, 3, '#7fd3ff'); break;
      case 'speaker': R(m, px + 2, py - 4, 12, 18, '#222'); R(m, px + 5, py - 1, 6, 6, '#444'); R(m, px + 7, py + 1, 2, 2, '#888'); R(m, px + 5, py + 7, 6, 5, '#444'); break;
    }
  }
  function drawChair(m, x, y, c) { const px = x * T, py = y * T; R(m, px + 3, py + 4, 10, 9, '#2d3142'); R(m, px + 4, py + 5, 8, 6, c || '#4f5d75'); }
  function buildStatic() {
    const m = mapCanvas.getContext('2d');
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { if (grid[y][x] === 1) continue; drawFloor(m, x, y, floor[y][x]); }
    for (const f of C.furniture.filter(f => f.blocking === false)) drawFurniture(m, f);
    for (const s of C.meetingSeats) drawChair(m, s[0], s[1], '#8a5a44');
    for (const a of C.agents) drawChair(m, a.seat[0], a.seat[1], S.shade(a.color, -0.2));
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y][x] === 1) drawWall(m, x, y);
    for (const f of C.furniture.filter(f => f.blocking !== false).sort((a, b) => a.y - b.y)) drawFurniture(m, f);
  }
  buildStatic();

  // ---------- Agent ----------
  const reserved = new Map(); // "x,y" -> agentId
  const key = (x, y) => x + ',' + y;
  class Agent {
    constructor(cfg) {
      this.cfg = cfg; this.id = cfg.id;
      this.x = cfg.seat[0]; this.y = cfg.seat[1];
      this.state = 'working'; this.mode = 'stay'; this.timer = rand(2, 10);
      this.path = []; this.dir = 'up'; this.anim = Math.random() * 10; this.wait = 0; this.repathed = false;
      this.target = cfg.seat.slice(); this.say = null; this.since = Date.now();
    }
    tile() { return [Math.round(this.x), Math.round(this.y)]; }
  }
  const agents = C.agents.map(c => new Agent(c));
  const byId = Object.fromEntries(agents.map(a => [a.id, a]));

  function freeFrom(list, a) {
    const free = list.filter(([x, y]) => { const r = reserved.get(key(x, y)); return !r || r === a.id; });
    return free.length ? free[(Math.random() * free.length) | 0] : null;
  }
  function release(a) { for (const [k, v] of reserved) if (v === a.id) reserved.delete(k); }
  function pickTarget(a, state) {
    if (state === 'working') return a.cfg.seat.slice();
    if (state === 'meeting') return freeFrom(C.meetingSeats, a) || hallTiles[(Math.random() * hallTiles.length) | 0];
    if (Math.random() < 0.7) { const s = freeFrom(C.loungeSpots, a); if (s) return s; }
    return hallTiles[(Math.random() * hallTiles.length) | 0];
  }
  function setState(a, state, stayFor) {
    release(a);
    const t = pickTarget(a, state);
    reserved.set(key(t[0], t[1]), a.id);
    a.state = state; a.target = t; a.wait = 0; a.repathed = false; a.stayFor = stayFor || null; a.since = Date.now();
    const [sx, sy] = a.tile();
    const p = bfs(sx, sy, t[0], t[1]);
    if (!p) { a.x = t[0]; a.y = t[1]; a.path = []; } else a.path = p;
    a.mode = 'walk';
    if (!a.path.length) arrive(a);
  }
  function arrive(a) {
    a.mode = 'stay'; a.x = a.target[0]; a.y = a.target[1];
    const d = { working: [14, 32], meeting: [10, 22], idle: [6, 16] }[a.state];
    a.timer = a.stayFor || rand(d[0], d[1]); a.stayFor = null;
    if (a.state === 'working') a.dir = 'up';
    else if (a.state === 'meeting') {
      const [mx, my] = C.meetingCenter, dx = mx - a.x, dy = my - a.y;
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    } else a.dir = ['down', 'left', 'right'][(Math.random() * 3) | 0];
  }
  function nextState(a) {
    const w = a.cfg.weights || { working: 0.5, meeting: 0.2, idle: 0.3 };
    let r = Math.random() * (w.working + w.meeting + w.idle);
    for (const s of ['working', 'meeting', 'idle']) { r -= w[s]; if (r <= 0) return s; }
    return 'working';
  }
  function occupied(a, x, y) {
    return agents.some(b => b !== a && Math.round(b.x) === x && Math.round(b.y) === y);
  }
  function update(a, dt) {
    a.anim += dt;
    if (a.say && Date.now() > a.say.until) a.say = null;
    if (a.mode === 'stay') {
      a.timer -= dt;
      if (a.timer <= 0) {
        const s = nextState(a);
        if (s === 'working' && a.state === 'working') { a.timer = rand(10, 20); return; }
        setState(a, s);
      }
      return;
    }
    if (!a.path.length) { arrive(a); return; }
    const [nx, ny] = a.path[0];
    const dx = nx - a.x, dy = ny - a.y, dist = Math.hypot(dx, dy);
    if (dist > 0.5 && occupied(a, nx, ny)) {   // 碰撞：前方有人 → 等待，必要時繞路
      a.wait += dt;
      if (a.wait > 0.5 && !a.repathed) {
        a.repathed = true;
        const bl = new Set(agents.filter(b => b !== a).map(b => { const [bx, by] = b.tile(); return by * COLS + bx; }));
        const p = bfs(Math.round(a.x), Math.round(a.y), a.target[0], a.target[1], bl);
        if (p && p.length) { a.path = p; return; }
      }
      if (a.wait < 1.6) return;  // 等太久就禮貌地擠過去
    }
    const step = WALK_SPEED * C.speedMul * dt;
    if (dist > 0.001) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (step >= dist) { a.x = nx; a.y = ny; a.path.shift(); a.wait = 0; a.repathed = false; }
    else { a.x += dx / dist * step; a.y += dy / dist * step; }
  }

  // 初始：隨機分配一些人在別處
  agents.forEach((a, i) => {
    const s = i % 3 === 1 ? 'idle' : i % 4 === 2 ? 'meeting' : 'working';
    if (s !== 'working') { release(a); const t = pickTarget(a, s); reserved.set(key(t[0], t[1]), a.id); a.state = s; a.target = t; arrive(a); a.timer = rand(3, 12); }
    else { reserved.set(key(a.x, a.y), a.id); }
  });

  // ---------- 繪製 ----------
  const world = document.createElement('canvas'); world.width = WW; world.height = WH;
  const wctx = world.getContext('2d');
  let canvas, dctx, selectedId = null, paused = false, showLabels = true;
  const frameHooks = [], selectHooks = [];

  function statusOf(a) {
    if (a.mode === 'walk') return Object.assign({ key: 'walking', dest: C.zones[{ working: a.cfg.zone, meeting: 'meeting', idle: 'lounge' }[a.state]] }, STATUS.walking);
    return Object.assign({ key: a.state }, STATUS[a.state]);
  }
  function activityOf(a) {
    const st = statusOf(a);
    if (st.key === 'walking') return a.state === 'idle' ? '去走走、休息一下' : '前往' + st.dest;
    if (a.state === 'working') return '在' + C.zones[a.cfg.zone] + '的座位上工作';
    if (a.state === 'meeting') return '在會議室開會';
    const r = roomOf[Math.round(a.y)][Math.round(a.x)];
    return r === 'lounge' ? '在休息區放空' : '在走廊散步';
  }

  function pill(ctx, text, cx, y, fs, bg, fg, dot, border) {
    ctx.font = `600 ${fs}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
    const tw = ctx.measureText(text).width, pad = fs * 0.45, dw = dot ? fs * 0.75 : 0;
    const w = tw + pad * 2 + dw, h = fs * 1.45, x = cx - w / 2;
    ctx.fillStyle = bg; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = Math.max(1, fs / 6); ctx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    if (dot) { ctx.fillStyle = dot; const ds = fs * 0.42; ctx.fillRect(Math.round(x + pad), Math.round(y + h / 2 - ds / 2), Math.round(ds), Math.round(ds)); }
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + pad + dw, y + h / 2 + 0.5);
    return h;
  }

  function render(now) {
    wctx.drawImage(mapCanvas, 0, 0);
    // 小動畫：機櫃燈號
    const blink = Math.floor(now / 400) % 2;
    for (const f of C.furniture) if (f.type === 'rack') for (let i = 0; i < 6; i++) R(wctx, f.x * T + 4, f.y * T - 3 + i * 6, 1, 1, (i + blink) % 2 ? '#4cd964' : '#2f3542');
    const sorted = agents.slice().sort((a, b) => a.y - b.y);
    for (const a of sorted) {
      if (a.id === selectedId) {
        const p = 0.5 + 0.5 * Math.sin(now / 180);
        wctx.fillStyle = `rgba(255,214,90,${0.35 + 0.35 * p})`;
        wctx.fillRect(Math.round(a.x * T) + 1, Math.round(a.y * T) + 11, 14, 5);
        wctx.fillRect(Math.round(a.x * T) + 3, Math.round(a.y * T) + 10, 10, 7);
      }
      S.draw(wctx, a.cfg, a.x * T, a.y * T, { dir: a.dir, frame: Math.floor(a.anim * 6) % 2, walking: a.mode === 'walk' });
    }
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(world, 0, 0, canvas.width, canvas.height);
    overlay();
  }

  function overlay() {
    const s = canvas.width / WW, css = canvas.clientWidth / WW || 1, dpr = canvas.width / (canvas.clientWidth || canvas.width);
    const fs = Math.max(8, Math.min(12, 5.4 * css)) * dpr;
    for (const r of C.rooms) pill(dctx, r.name, (r.x + r.w / 2) * T * s, (r.y + 0.15) * T * s, fs * 1.05, 'rgba(22,26,43,.85)', '#ffe08a');
    const sorted = agents.slice().sort((a, b) => a.y - b.y);
    for (const a of sorted) {
      const cx = (a.x * T + 8) * s, sel = a.id === selectedId;
      if (showLabels || sel) pill(dctx, a.cfg.short, cx, (a.y * T + 15) * s, fs * 0.92, sel ? '#ffd65a' : 'rgba(15,18,32,.82)', sel ? '#1a1a1a' : '#fff', null, sel ? '#1a1a1a' : null);
      const top = (a.y * T - 10) * s - fs * 1.4;
      if (a.say) pill(dctx, a.say.text, cx, top - fs * 0.2, fs * 0.92, '#ffffff', '#1a1a2a', null, '#1a1a2a');
      else if (showLabels || sel) { const st = statusOf(a); pill(dctx, st.label, cx, top, fs * 0.82, 'rgba(15,18,32,.78)', '#e8ecf5', st.color); }
    }
    if (paused) pill(dctx, '⏸ 已暫停', canvas.width / 2, canvas.height / 2 - fs, fs * 1.6, 'rgba(0,0,0,.7)', '#fff');
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) agents.forEach(a => update(a, dt));
    render(now);
    frameHooks.forEach(fn => fn());
    requestAnimationFrame(loop);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.width = w; canvas.height = Math.round(w * WH / WW);
  }

  function hitTest(clientX, clientY, touch) {
    const rect = canvas.getBoundingClientRect();
    const wx = (clientX - rect.left) / rect.width * WW, wy = (clientY - rect.top) / rect.height * WH;
    const rad = touch ? 16 : 11;
    let best = null, bd = 1e9;
    for (const a of agents) {
      const d = Math.hypot(a.x * T + 8 - wx, a.y * T + 6 - wy);
      if (d < rad && d < bd) { best = a; bd = d; }
    }
    return best;
  }

  function select(id) { selectedId = id; selectHooks.forEach(fn => fn(id)); }

  function init(el) {
    canvas = el; dctx = canvas.getContext('2d');
    new ResizeObserver(resize).observe(canvas); resize();
    canvas.addEventListener('pointerup', e => {
      const a = hitTest(e.clientX, e.clientY, e.pointerType !== 'mouse');
      select(a ? a.id : null);
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') canvas.style.cursor = hitTest(e.clientX, e.clientY, false) ? 'pointer' : 'default';
    });
    requestAnimationFrame(loop);
  }

  window.Office = {
    init, agents, byId, statusOf, activityOf, STATUS,
    select, getSelected: () => selectedId,
    onSelect: fn => selectHooks.push(fn), onFrame: fn => frameHooks.push(fn),
    setState: (id, st, stay) => byId[id] && setState(byId[id], st, stay),
    setAll: (st, stay) => agents.forEach(a => setState(a, st, stay)),
    say: (id, text, ms) => { if (byId[id]) byId[id].say = { text, until: Date.now() + (ms || 2500) }; },
    togglePause: () => (paused = !paused),
    toggleLabels: () => (showLabels = !showLabels),
    // 角色在 canvas 上的 CSS 座標（給 popover 定位用）
    screenPos: id => { const a = byId[id]; if (!a || !canvas) return null; const k = canvas.clientWidth / WW; return { x: (a.x * T + 8) * k, y: (a.y * T) * k }; },
  };
})();
