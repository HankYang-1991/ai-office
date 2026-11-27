/* 辦公室引擎 v2：8 房格子地圖、尋路(BFS)、碰撞、Agent 狀態機（可由 JSON 狀態接管）、Canvas 繪製 */
(function () {
  const C = window.OFFICE_CONFIG, S = window.OfficeSprites;
  const T = C.tile, COLS = C.cols, ROWS = C.rows, WW = COLS * T, WH = ROWS * T;
  const WALK_SPEED = 3.4; // 格/秒
  const STATUS = {
    working: { label: '工作中', color: '#4cd964' },
    idle:    { label: '閒置',   color: '#a7b0c4' },
    meeting: { label: '開會中', color: '#f5a623' },
    walking: { label: '移動中', color: '#5ac8fa' },
    charge:  { label: '充電中', color: '#ff9d3b' },
    visit:   { label: '交接中', color: '#ffd65a' },
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
  const roomName = id => (C.rooms.find(r => r.id === id) || {}).name || '走廊';
  const roomAt = (x, y) => (roomOf[Math.round(y)] || [])[Math.round(x)] || null;

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
      case 'trade': R(m, px, py, T, T, odd ? '#252b44' : '#222840'); R(m, px, py, T, 1, '#1b2036'); if ((x + y) % 4 === 0) R(m, px + 7, py + 7, 2, 2, '#2d3556'); break;
      case 'blueprint': R(m, px, py, T, T, '#b9c9e2'); R(m, px, py, T, 1, '#a5b8d6'); R(m, px, py, 1, T, '#a5b8d6'); if (odd) R(m, px + 8, py + 8, 1, 1, '#90a7cc'); break;
      case 'server': R(m, px, py, T, T, '#8e95a3'); R(m, px + 1, py + 1, T - 2, T - 2, odd ? '#a2a9b6' : '#9aa1ae'); R(m, px + 3, py + 3, 1, 1, '#6d7482'); R(m, px + 12, py + 12, 1, 1, '#6d7482'); break;
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
        } else if (f.deco === 'trading') {
          for (const mx of [cx - 22, cx - 11, cx, cx + 11]) { R(m, mx, py - 6, 10, 8, '#1d2130'); R(m, mx + 1, py - 5, 8, 5, '#07140f'); R(m, mx + 4, py + 2, 2, 2, '#333'); }
          R(m, cx - 6, py + 7, 12, 2, '#e9e9ee'); R(m, px + 3, py + 5, 4, 3, '#f5f5f5');
        } else if (f.deco === 'chart') {
          for (const mx of [cx - 10, cx + 1]) { R(m, mx, py - 5, 10, 8, '#1d2130'); R(m, mx + 1, py - 4, 8, 5, '#07140f'); R(m, mx + 4, py + 3, 2, 2, '#333'); }
          R(m, cx - 4, py + 7, 8, 2, '#e9e9ee');
        } else if (f.deco === 'review') {
          R(m, cx - 9, py, 18, 10, '#f6f8ff'); for (let i = 0; i < 3; i++) R(m, cx - 7, py + 2 + i * 3, 9, 1, '#1c3f8f');
          R(m, cx + 4, py + 2, 4, 4, '#c0392b'); R(m, cx + 5, py + 7, 3, 1, '#2ecc71'); R(m, px + 2, py + 3, 3, 1, '#e74c3c');
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
      case 'arcade': // 像素街機（螢幕在 drawLive 動態繪製）
        R(m, px + 1, py + h - 2, w - 2, 3, 'rgba(0,0,0,.25)');
        R(m, px + 1, py - 7, w - 2, h + 6, '#3a2a6e'); R(m, px + 1, py - 7, 2, h + 6, '#5a46a8'); R(m, px + w - 3, py - 7, 2, h + 6, '#2a1f52');
        R(m, px + 2, py - 6, w - 4, 5, '#ffd65a'); R(m, px + 4, py - 5, 2, 2, '#e85d4a'); R(m, px + 7, py - 5, 2, 2, '#3d7fb0'); R(m, px + 10, py - 5, 2, 2, '#2c8f4a');
        R(m, px + 2, py, w - 4, 11, '#0b0e19'); R(m, px + 3, py + 1, w - 6, 9, '#9fdcf0');
        R(m, px, py + 11, w, 4, '#2a1f52'); R(m, px, py + 11, w, 1, '#6a56b8');
        R(m, px + 4, py + 10, 1, 3, '#222'); R(m, px + 3, py + 9, 3, 2, '#ff5f57'); R(m, px + 9, py + 12, 2, 1, '#4cd964'); R(m, px + 12, py + 12, 2, 1, '#ffd65a');
        R(m, px + 3, py + 16, w - 6, 12, '#2e225c'); R(m, px + 6, py + 19, 4, 3, '#ffd65a'); R(m, px + 7, py + 20, 2, 1, '#111');
        R(m, px + 4, py + 24, w - 8, 1, '#5a46a8'); break;
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

      // ---- v2 新家具 ----
      case 'marketwall':   // 多螢幕行情牆：外框是靜態的，K 線在 drawLive 裡動
        R(m, px - 2, py - 11, w + 4, 14, '#0b0e16'); R(m, px - 2, py - 11, w + 4, 1, '#3a4260');
        for (let k = 0; k < 5; k++) { const sx = px + k * (w / 5); R(m, sx + 1, py - 9, w / 5 - 2, 10, '#07140f'); }
        R(m, px + w / 2 - 6, py + 2, 12, 2, '#2a2f45'); break;
      case 'exchange':     // 交易所連線燈箱
        R(m, px + 1, py - 6, w - 2, h + 5, '#1a1f2e'); R(m, px + 2, py - 5, w - 4, 2, '#39405c');
        for (let k = 0; k < 4; k++) R(m, px + 3, py - 1 + k * 6, w - 6, 4, '#0d1018'); break;
      case 'tickerboard':  // 跑馬燈看板
        R(m, px, py - 4, w, 12, '#11131c'); R(m, px, py - 4, w, 1, '#3a4260'); R(m, px + 1, py - 2, w - 2, 8, '#050608');
        R(m, px + 3, py + 8, 2, 7, '#2a2f45'); R(m, px + w - 5, py + 8, 2, 7, '#2a2f45'); break;
      case 'sldboard':     // 牆上的單線圖（SLD）
        R(m, px, py - 9, w, 12, '#9aa0ab'); R(m, px + 1, py - 8, w - 2, 10, '#f6f8ff');
        R(m, px + 6, py - 7, 1, 8, '#1c3f8f'); for (let k = 0; k < 4; k++) { R(m, px + 6, py - 6 + k * 2, 8 + k * 3, 1, '#1c3f8f'); R(m, px + 14 + k * 3, py - 7 + k * 2, 3, 3, k % 2 ? '#c0392b' : '#1c3f8f'); }
        R(m, px + w - 18, py - 7, 12, 6, '#dfe8ff'); R(m, px + w - 16, py - 5, 8, 1, '#1c3f8f'); R(m, px + w - 16, py - 3, 6, 1, '#1c3f8f'); break;
      case 'qaboard':      // QA 審查看板（待審／審查中／通過）
        R(m, px, py - 9, w, 12, '#6b4a2b'); R(m, px + 1, py - 8, w - 2, 10, '#f2ead8');
        for (let c = 0; c < 3; c++) { const cx0 = px + 2 + c * ((w - 4) / 3); R(m, cx0, py - 8, 1, 10, '#c9b896');
          for (let k = 0; k < 3 - c % 2; k++) R(m, cx0 + 3, py - 6 + k * 3, 8, 2, ['#ffd65a', '#8fd0f0', '#9ef0b4'][c]); }
        break;
      case 'bptable':      // 大型藍圖桌
        R(m, px, py, w, h, '#5e3818'); R(m, px + 1, py + 1, w - 2, h - 4, '#1f4f99'); R(m, px + 1, py + h - 3, w - 2, 2, '#3e2410');
        for (let k = 0; k < 4; k++) R(m, px + 4, py + 4 + k * 6, w - 8 - k * 7, 1, '#cfe3ff');
        R(m, px + w - 18, py + 5, 10, 10, '#2a62b8'); R(m, px + w - 18, py + 5, 10, 1, '#cfe3ff'); R(m, px + w - 18, py + 5, 1, 10, '#cfe3ff');
        R(m, px + 6, py + h - 9, 6, 3, '#f1c40f'); break;
      case 'poolrack':     // 額度機櫃：燈號在 drawLive 依額度池變色
        R(m, px + 1, py - 10, w - 2, h + 10, '#151922'); R(m, px + 1, py - 10, w - 2, 1, '#3a4260');
        for (let k = 0; k < 8; k++) R(m, px + 3, py - 8 + k * 5, w - 6, 3, '#232836');
        break;
      case 'opsconsole':   // 額度中控大螢幕
        R(m, px - 1, py - 11, w + 2, 15, '#0d1018'); R(m, px - 1, py - 11, w + 2, 1, '#3a4260'); R(m, px, py - 10, w, 12, '#08121a'); break;
    }
  }
  function drawChair(m, x, y, c) { const px = x * T, py = y * T; R(m, px + 3, py + 4, 10, 9, '#2d3142'); R(m, px + 4, py + 5, 8, 6, c || '#4f5d75'); }
  function buildStatic() {
    const m = mapCanvas.getContext('2d');
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { if (grid[y][x] === 1) continue; drawFloor(m, x, y, floor[y][x]); }
    for (const f of C.furniture.filter(f => f.blocking === false)) drawFurniture(m, f);
    for (const s of C.meetingSeats) drawChair(m, s[0], s[1], '#8a5a44');
    // 座位上的椅子在 render 時畫：坐姿圖已含椅子，坐著時不重複畫
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y][x] === 1) drawWall(m, x, y);
    for (const f of C.furniture.filter(f => f.blocking !== false).sort((a, b) => a.y - b.y)) drawFurniture(m, f);
  }
  buildStatic();

  // ---------- 座位：每張有主人的書桌 = 一個座位（主座位 + 圖面審查室的第二座位） ----------
  const deskSeat = f => f.seat || [f.x + Math.floor(f.w / 2), f.y + 1];
  const desks = C.furniture.filter(f => f.type === 'desk' && f.owner);
  const seats = desks.map(f => ({ owner: f.owner, pos: deskSeat(f), alt: !!f.alt, desk: f }));
  const sameTile = (p, q) => p && q && p[0] === q[0] && p[1] === q[1];

  // ---------- Agent ----------
  const reserved = new Map(); // "x,y" -> agentId
  const key = (x, y) => x + ',' + y;
  class Agent {
    constructor(cfg) {
      this.cfg = cfg; this.id = cfg.id;
      this.x = cfg.seat[0]; this.y = cfg.seat[1];
      this.state = 'working'; this.mode = 'stay'; this.timer = rand(2, 10);
      this.dir = 'up'; this.path = []; this.anim = Math.random() * 10; this.wait = 0;
      this.target = cfg.seat.slice(); this.say = null; this.since = Date.now();
      this.fx = {}; this.spot = null; this.onArrive = null; this.manual = 0; this.note = '';
    }
    tile() { return [Math.round(this.x), Math.round(this.y)]; }
  }
  const agents = C.agents.map(c => new Agent(c));
  const byId = Object.fromEntries(agents.map(a => [a.id, a]));

  function freeFrom(list, a) {
    const free = (list || []).filter(([x, y]) => walkable(x, y) && (() => { const r = reserved.get(key(x, y)); return !r || r === a.id; })());
    return free.length ? free[(Math.random() * free.length) | 0] : null;
  }
  function release(a) { for (const [k, v] of reserved) if (v === a.id) reserved.delete(k); }
  const randHall = () => hallTiles[(Math.random() * hallTiles.length) | 0];
  function pickTarget(a, state, o) {
    if (o.target) return o.target.slice();
    if (state === 'working') return (o.seat || a.cfg.seat).slice();
    if (state === 'meeting') return freeFrom(C.meetingSeats, a) || randHall();
    if (state === 'charge') return freeFrom(C.chargeSpots, a) || freeFrom(C.loungeSpots, a) || randHall();
    if (o.spot && C.breakSpots && C.breakSpots[o.spot]) { const s = freeFrom(C.breakSpots[o.spot].tiles, a); if (s) return s; }
    if (Math.random() < 0.7) { const s = freeFrom(C.loungeSpots, a); if (s) return s; }
    return randHall();
  }
  /** state: working | meeting | idle | charge | visit；o: { seat, target, spot, onArrive, note } */
  function setState(a, state, stayFor, o) {
    o = o || {};
    release(a);
    const t = pickTarget(a, state, o);
    reserved.set(key(t[0], t[1]), a.id);
    a.state = state; a.target = t; a.wait = 0; a.repathed = false; a.stayFor = stayFor || null; a.since = Date.now();
    a.spot = o.spot || null; a.onArrive = o.onArrive || null; a.note = o.note || '';
    const [sx, sy] = a.tile();
    const p = bfs(sx, sy, t[0], t[1]);
    if (!p) { a.x = t[0]; a.y = t[1]; a.path = []; } else a.path = p;
    a.mode = 'walk';
    if (!a.path.length) arrive(a);
  }
  function arrive(a) {
    a.mode = 'stay'; a.x = a.target[0]; a.y = a.target[1];
    const d = { working: [14, 32], meeting: [10, 22], idle: [6, 16], charge: [20, 40], visit: [2, 2] }[a.state] || [6, 12];
    a.timer = a.stayFor || rand(d[0], d[1]); a.stayFor = null;
    if (a.state === 'working') a.dir = 'up';
    else if (a.state === 'meeting') {
      const [mx, my] = C.meetingCenter, dx = mx - a.x, dy = my - a.y;
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    } else if (a.state === 'visit' && a.faceTo) {
      const dx = a.faceTo[0] - a.x, dy = a.faceTo[1] - a.y;
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    } else a.dir = ['down', 'left', 'right'][(Math.random() * 3) | 0];
    const cb = a.onArrive; a.onArrive = null; if (cb) cb(a);
  }
  function nextState(a) {
    const w = a.cfg.weights || { working: 0.5, meeting: 0.2, idle: 0.3 };
    let r = Math.random() * (w.working + w.meeting + w.idle);
    for (const s of ['working', 'meeting', 'idle']) { r -= w[s]; if (r <= 0) return s; }
    return 'working';
  }
  // 自動狀態（JSON 接管）：brain(a) 回傳 { state, stay, seat, spot, note } 或 null（= 用原本的隨機權重）
  let brain = null;
  function replan(a) {
    const plan = brain ? brain(a) : null;
    if (plan) {
      if (plan.state === 'working' && a.state === 'working' && sameTile(a.target, plan.seat || a.cfg.seat) && a.mode === 'stay') { a.timer = plan.stay || rand(14, 30); a.note = plan.note || ''; return; }
      setState(a, plan.state, plan.stay, plan);
      return;
    }
    const s = nextState(a);
    if (s === 'working' && a.state === 'working') { a.timer = rand(10, 20); return; }
    setState(a, s);
  }
  function occupied(a, x, y) {
    return agents.some(b => b !== a && Math.round(b.x) === x && Math.round(b.y) === y);
  }
  function update(a, dt) {
    a.anim += dt * (a.fx.turbo && isSeated(a) ? 3 : 1);
    if (a.say && Date.now() > a.say.until) a.say = null;
    if (a.mode === 'stay') {
      a.timer -= dt;
      if (a.timer <= 0) { a.manual = 0; replan(a); }
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

  // 初始：隨機分配一些人在別處（自動狀態啟動後，第一次讀到資料就會重新安排）
  agents.forEach((a, i) => {
    const s = i % 3 === 1 ? 'idle' : i % 4 === 2 ? 'meeting' : 'working';
    if (s !== 'working') { release(a); const t = pickTarget(a, s, {}); reserved.set(key(t[0], t[1]), a.id); a.state = s; a.target = t; arrive(a); a.timer = rand(3, 12); }
    else { reserved.set(key(a.x, a.y), a.id); }
  });

  // ---------- 走路圖（大沼王畫的角色）：載入失敗就用程式繪製的像素角色 ----------
  const sheets = {};
  const WALK = (C.assets && C.assets.walk) || {};
  const ROW = { down: 0, left: 1, right: 2, up: 3 };
  const SPR = 22;
  const SIT_LIFT = 5;
  function inspectSheet(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w < 96 || h < 128) return null;
    if (w % 3 === 0) {
      const cell = w / 3, rows = Math.floor(h / cell);
      if (cell >= 16 && rows >= 4) {
        const footPad = cell >= 48 ? Math.round(cell * 4 / 64) : 0;
        return { cell, rows, footPad };
      }
    }
    return { cell: 32, rows: 4, footPad: 0 };
  }
  const atSeat = a => a.mode === 'stay' && a.state === 'working' && seats.some(s => s.owner === a.id && sameTile(s.pos, a.target));
  function isSeated(a) {
    const sh = sheets[a.id];
    return !!(atSeat(a) && sh && sh.rows >= 5);
  }
  for (const a of agents) {
    const src = WALK[a.id]; if (!src) continue;
    const img = new Image(); img.decoding = 'async';
    img.onload = () => { const meta = inspectSheet(img); if (!meta) return; sheets[a.id] = { img, ...meta }; };
    img.onerror = () => { delete sheets[a.id]; };
    img.src = src;
  }

  // ---------- 即時資料（由 app.js 餵入） ----------
  let pools = {};            // id -> { used, tier, stale, charging, short }
  const roomInfo = {};       // roomId -> { text, pct, color }
  let mapBanner = null;      // 回放中等提示
  const TIER_LED = { green: '#4cd964', amber: '#f5b723', red: '#ff5f57', stale: '#ff9d3b', na: '#3a4058' };

  // ---------- 繪製 ----------
  const world = document.createElement('canvas'); world.width = WW; world.height = WH;
  const wctx = world.getContext('2d');
  let canvas, dctx, selectedId = null, paused = false, showLabels = true;
  const frameHooks = [], selectHooks = [];

  function statusOf(a) {
    if (a.mode === 'walk') {
      const dest = a.state === 'visit' ? (byId[a.visitTo] ? byId[a.visitTo].cfg.short + ' 的座位' : '同事座位') : roomName(roomAt(a.target[0], a.target[1]));
      return Object.assign({ key: 'walking', dest }, STATUS.walking);
    }
    return Object.assign({ key: a.state }, STATUS[a.state] || STATUS.idle);
  }
  function activityOf(a) {
    const st = statusOf(a);
    if (st.key === 'walking') {
      if (a.state === 'charge') return '額度用完，走去休息區充電';
      if (a.state === 'visit') return '送任務到' + st.dest;
      return a.state === 'idle' ? '去休息區走走' : '前往' + st.dest;
    }
    if (a.state === 'charge') return '額度池滿載／限流，在休息區充電中';
    if (a.state === 'visit') return '把任務交接給' + (byId[a.visitTo] ? byId[a.visitTo].cfg.short : '同事');
    if (a.state === 'working') return '在' + roomName(roomAt(a.x, a.y)) + '的座位上工作' + (a.note ? '（' + a.note + '）' : '');
    if (a.state === 'meeting') return '在會議室開會';
    if (a.spot && C.breakSpots && C.breakSpots[a.spot]) return C.breakSpots[a.spot].label;
    const r = roomAt(a.x, a.y);
    return r === 'lounge' ? '在休息區放空' : r ? '在' + roomName(r) + '走動' : '在走廊散步';
  }

  function pill(ctx, text, cx, y, fs, bg, fg, dot, border) {
    ctx.font = `600 ${fs}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
    const tw = ctx.measureText(text).width, pad = fs * 0.45, dw = dot ? fs * 0.75 : 0;
    const w = tw + pad * 2 + dw, h = fs * 1.45, x = cx - w / 2;
    ctx.fillStyle = bg; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = Math.max(1, fs / 6); ctx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    if (dot) { ctx.fillStyle = dot; const ds = fs * 0.42; ctx.fillRect(Math.round(x + pad), Math.round(y + h / 2 - ds / 2), Math.round(ds), Math.round(ds)); }
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + pad + dw, y + h / 2 + 0.5);
    return { h, w, x };
  }

  // 角色專屬的像素小圖示（工作中冒在頭上）
  const PAL = { G: '#3ecf8e', R: '#ff5f57', Y: '#ffd65a', B: '#4fa3ff', W: '#ffffff', C: '#7fe3ff', S: '#c9d0e6', K: '#1a1f2e', P: '#c084fc', N: '#a46b37', M: '#8cdcd2', O: '#ff9d3b' };
  const ICONS = {
    code: ['..C..CC..', '.C...C.C.', 'C...C...C', '.C.C...C.', '..CC..C..'],
    kline: ['.R....G', 'RRR..GG', 'RRR.G.G', 'RRR.GG.', '.R..GGG', '....GGG', '.....G.'],
    bolt: ['...YY.', '..YY..', '.YY...', 'YYYYY.', '..YY..', '.YY...', '.Y....'],
    blueprint: ['BBBBBBB', 'BWWWBWB', 'BWBWBBB', 'BWWWBWB', 'BBBBBWB', 'BBBBBBB'],
    search: ['.SSS..', 'S...S.', 'S...S.', '.SSS..', '....Y.', '.....Y'],
    gear: ['..S.S..', '.SSSSS.', 'SSS.SSS', 'SS...SS', 'SSS.SSS', '.SSSSS.', '..S.S..'],
    sparkle: ['...P...', '...P...', '..PPP..', 'PPPWPPP', '..PPP..', '...P...', '...P...'],
    brush: ['.....NN', '....NN.', '...NN..', '..NN...', '.YY....', 'YYY....', 'YY.....'],
    camera: ['..SS...', 'SSSSSSS', 'SSKKKSS', 'SSKCKSS', 'SSKKKSS', 'SSSSSSS'],
    note: ['..MMMMM', '..M...M', '..M...M', '..M...M', 'MMM.MMM', 'MMM.MMM'],
    battery: ['.GGGGG.', 'GGGGGGG', 'G.....G', 'GGG...G', 'GGGGG.G', 'GGGGGGG'],
    mail: ['YYYYYYY', 'YY...YY', 'Y.Y.Y.Y', 'Y..Y..Y', 'YYYYYYY'],
  };
  function iconPill(ctx, icon, text, cx, y, fs, border) {
    const bm = ICONS[icon]; const ps = Math.max(1, Math.round(fs / 7));
    ctx.font = `600 ${fs}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
    const iw = bm ? bm[0].length * ps : 0, ih = bm ? bm.length * ps : 0;
    const tw = text ? ctx.measureText(text).width : 0, pad = fs * 0.4, gap = text && bm ? fs * 0.35 : 0;
    const h = Math.max(fs * 1.45, ih + pad), w = iw + tw + gap + pad * 2, x = Math.round(cx - w / 2), yy = Math.round(y);
    R(ctx, x, yy, Math.round(w), Math.round(h), 'rgba(14,17,30,.92)');
    ctx.strokeStyle = border || '#ffd65a'; ctx.lineWidth = Math.max(1, fs / 6); ctx.strokeRect(x, yy, Math.round(w), Math.round(h));
    if (bm) { const ox = Math.round(x + pad), oy = Math.round(yy + (h - ih) / 2);
      bm.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') R(ctx, ox + i * ps, oy + j * ps, ps, ps, PAL[row[i]]); }); }
    if (text) { ctx.fillStyle = '#e8ecf5'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + pad + iw + gap, yy + h / 2 + 0.5); }
    return h;
  }

  // 牆上時鐘（台北時間）
  const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: C.timeZone || 'Asia/Taipei', hour: 'numeric', minute: 'numeric', hour12: false });
  const CLOCK = C.clock || [6, 1];
  function drawClock(ctx, nowMs) {
    const [hh, mm] = clockFmt.format(new Date(nowMs)).split(':').map(Number);
    const cx = CLOCK[0] * T + 8, cy = CLOCK[1] * T + 10;
    R(ctx, cx - 4, cy - 5, 9, 11, '#3b2a1a'); R(ctx, cx - 5, cy - 4, 11, 9, '#3b2a1a');
    R(ctx, cx - 3, cy - 4, 7, 9, '#fbf6e9'); R(ctx, cx - 4, cy - 3, 9, 7, '#fbf6e9');
    const hand = (ang, len, c) => { for (let i = 1; i <= len; i++) R(ctx, Math.round(cx + Math.sin(ang) * i), Math.round(cy - Math.cos(ang) * i), 1, 1, c); };
    hand((mm / 60) * 2 * Math.PI, 3, '#2a2a3a');
    hand(((hh % 12) / 12 + mm / 720) * 2 * Math.PI, 2, '#c0392b');
    R(ctx, cx, cy, 1, 1, '#c0392b');
  }
  // 程序化 K 線：每根依 seed 決定高低，隨時間往左捲動
  const hash = n => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  function drawCandles(ctx, x0, y0, w, h, t, n) {
    const cw = 3, count = Math.floor(w / cw);
    let lvl = 0.5;
    for (let i = 0; i < count; i++) {
      const k = t + i, r = hash(k) - 0.5; const open = lvl; lvl = Math.max(0.1, Math.min(0.9, lvl + r * 0.35)); const close = lvl;
      const hi = Math.max(open, close) + hash(k + 7) * 0.12, lo = Math.min(open, close) - hash(k + 3) * 0.12;
      const up = close >= open, c = up ? '#3ecf8e' : '#ff5f57';
      const yy = v => Math.round(y0 + h - v * h);
      R(ctx, x0 + i * cw + 1, yy(Math.min(1, hi)), 1, Math.max(1, yy(Math.max(0, lo)) - yy(Math.min(1, hi))), c);
      R(ctx, x0 + i * cw, yy(Math.max(open, close)), 2, Math.max(1, Math.abs(yy(open) - yy(close))), c);
    }
  }
  function quantHeat() {
    const g = byId.gpt; if (!g) return 0;
    return (g.fx.active ? 1 : 0) + (atSeat(g) ? 1 : 0);
  }
  // 書桌螢幕與房間即時設備
  function drawLive(ctx, now) {
    const heat = quantHeat();
    const tick = Math.floor(now / (heat >= 2 ? 160 : heat === 1 ? 420 : 1400));
    for (const f of desks) {
      const a = byId[f.owner]; if (!a) continue;
      const here = atSeat(a) && sameTile(a.target, deskSeat(f));
      const px = f.x * T, py = f.y * T, cx = px + f.w * T / 2;
      if (f.deco === 'pc' || f.deco === 'pc2') {
        const mons = f.deco === 'pc2' ? [cx - 10, cx + 1] : [cx - 5];
        mons.forEach((mx, k) => {
          if (!here) { R(ctx, mx + 1, py - 4, 8, 5, '#1f2a38'); return; }
          const t = Math.floor(now / (a.fx.turbo ? 120 : 350)) + k * 3;
          for (let i = 0; i < 3; i++) R(ctx, mx + 2, py - 4 + i * 2 - (i ? 1 : 0), 1 + ((t + i * 5) % 6), 1, i === 1 ? '#ffe08a' : '#d9f4ff');
        });
      } else if (f.deco === 'trading') {
        [cx - 22, cx - 11, cx, cx + 11].forEach((mx, k) => here || heat ? drawCandles(ctx, mx + 1, py - 5, 8, 5, tick + k * 11, 3) : R(ctx, mx + 1, py - 5, 8, 5, '#0d1a14'));
      } else if (here) {
        const b = Math.floor(now / 500) % 3;
        const c = { drawing: '#f1c40f', camera: '#ffffff', piano: '#ffd65a', drafting: '#3d6fd8', blueprint: '#cfe3ff', review: '#c0392b' }[f.deco] || '#ffd65a';
        if (f.deco === 'piano') { R(ctx, cx + 4, py - 6 - b, 1, 4, c); R(ctx, cx + 2, py - 3 - b, 3, 2, c); }
        else R(ctx, cx + 6, py - 2 - b, 1, 1, c);
      }
    }
    for (const f of C.furniture) {
      const px = f.x * T, py = f.y * T, w = f.w * T;
      if (f.type === 'chart') continue;
      if (f.type === 'desk' && f.deco === 'chart') {
        const cx = px + w / 2;
        [cx - 10, cx + 1].forEach((mx, k) => heat ? drawCandles(ctx, mx + 1, py - 4, 8, 5, tick + k * 5 + f.x, 3) : R(ctx, mx + 1, py - 4, 8, 5, '#0d1a14'));
      } else if (f.type === 'marketwall') {
        for (let k = 0; k < 5; k++) { const sx = px + k * (w / 5); drawCandles(ctx, sx + 2, py - 8, w / 5 - 4, 8, tick + k * 17, 3); }
      } else if (f.type === 'exchange') {
        for (let k = 0; k < 4; k++) { const on = heat ? (Math.floor(now / 250) + k) % 3 !== 0 : k === 0; R(ctx, px + 4, py + k * 6, 2, 2, on ? (k === 3 ? '#ffd65a' : '#3ecf8e') : '#2a3040'); R(ctx, px + 8, py + k * 6, 4, 1, on ? '#3ecf8e' : '#2a3040'); }
      } else if (f.type === 'tickerboard') {
        const tx = (Math.floor(now / (heat ? 60 : 180)) % (w + 40));
        ctx.save(); ctx.beginPath(); ctx.rect(px + 1, py - 2, w - 2, 8); ctx.clip();
        for (let i = 0; i < 12; i++) { const x = px + w - tx + i * 14; const up = hash(i + Math.floor(now / 9000)) > 0.45; R(ctx, x, py + 1, 6, 2, up ? '#3ecf8e' : '#ff5f57'); R(ctx, x + 7, py, 2, 1, up ? '#3ecf8e' : '#ff5f57'); R(ctx, x + 7, py + 3, 2, 1, '#ffd65a'); }
        ctx.restore();
      } else if (f.type === 'arcade') {   // 街機螢幕：迷你沼王在跳台
        const b = Math.round(Math.abs(Math.sin(now / 260)) * 4), sx = px + 3, sy = py + 1;
        R(ctx, sx, sy, 10, 9, '#9fdcf0'); R(ctx, sx, sy + 6, 10, 3, '#bfe8f4');
        R(ctx, sx + 1, sy + 8, 4, 1, '#4cbf5a'); R(ctx, sx + 6, sy + 4, 4, 1, '#4cbf5a'); R(ctx, sx + 2, sy + 2, 3, 1, '#ff5f57');
        R(ctx, sx + 2, sy + 5 - b, 2, 3, '#5a9fd6'); R(ctx, sx + 2, sy + 5 - b, 1, 1, '#1a1a2a');
        if (arcadeHover || Math.floor(now / 700) % 2) R(ctx, sx + 7, sy + 1, 2, 1, '#ffd65a');
        if (arcadeHover) { R(ctx, px, py - 8, w, 1, '#ffd65a'); R(ctx, px, py - 8, 1, f.h * T + 8, '#ffd65a'); R(ctx, px + w - 1, py - 8, 1, f.h * T + 8, '#ffd65a'); }
      } else if (f.type === 'poolrack') {
        const p = pools[f.pool] || null, t = p ? (p.stale ? 'stale' : p.tier) : 'na';
        const lit = p && typeof p.used === 'number' ? Math.max(1, Math.ceil(p.used / 12.5)) : 0;
        const blinkOn = t !== 'red' || Math.floor(now / 350) % 2 === 0;
        for (let k = 0; k < 8; k++) {
          const on = (7 - k) < lit; const c = on && blinkOn ? TIER_LED[t] : '#2a2f40';
          R(ctx, px + 4, py - 7 + k * 5, 4, 1, c); R(ctx, px + w - 7, py - 7 + k * 5, 2, 1, (Math.floor(now / 300) + k + f.x) % 4 ? '#3a4058' : '#4cd964');
        }
      } else if (f.type === 'opsconsole') {
        const ids = ['team', 'codex', 'claude', 'gemini_sub', 'gemini_api', 'openai'];
        ids.forEach((id, k) => { const p = pools[id]; const bw = w - 6; R(ctx, px + 3, py - 8 + k * 2, bw, 1, '#18222c');
          if (p && typeof p.used === 'number') R(ctx, px + 3, py - 8 + k * 2, Math.max(1, Math.round(bw * p.used / 100)), 1, TIER_LED[p.stale ? 'stale' : p.tier]); });
      } else if (f.type === 'rack') {
        const blink = Math.floor(now / 400) % 2;
        for (let i = 0; i < 6; i++) R(ctx, f.x * T + 4, f.y * T - 3 + i * 6, 1, 1, (i + blink) % 2 ? '#4cd964' : '#2f3542');
      }
    }
  }

  function render(now) {
    wctx.drawImage(mapCanvas, 0, 0);
    drawLive(wctx, now);
    drawClock(wctx, Date.now());
    for (const s of seats) {
      const occ = agents.find(a => isSeated(a) && sameTile(a.target, s.pos));
      if (!occ) drawChair(wctx, s.pos[0], s.pos[1], S.shade((byId[s.owner] || { cfg: { color: '#4f5d75' } }).cfg.color, -0.2));
    }
    const sorted = agents.slice().sort((a, b) => a.y - b.y);
    for (const a of sorted) {
      if (a.id === selectedId) {
        const p = 0.5 + 0.5 * Math.sin(now / 180);
        wctx.fillStyle = `rgba(255,214,90,${0.35 + 0.35 * p})`;
        wctx.fillRect(Math.round(a.x * T) + 1, Math.round(a.y * T) + 11, 14, 5);
        wctx.fillRect(Math.round(a.x * T) + 3, Math.round(a.y * T) + 10, 10, 7);
      }
      if (sheets[a.id]) { wctx.fillStyle = 'rgba(0,0,0,.28)'; wctx.fillRect(Math.round(a.x * T) + 3, Math.round(a.y * T) + 13, 10, 2); wctx.fillRect(Math.round(a.x * T) + 4, Math.round(a.y * T) + 12, 8, 1); }
      else S.draw(wctx, a.cfg, a.x * T, a.y * T, { dir: a.dir, frame: Math.floor(a.anim * 6) % 2, walking: a.mode === 'walk' });
    }
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(world, 0, 0, canvas.width, canvas.height);
    const s = canvas.width / WW;
    for (const a of sorted) {
      const sheet = sheets[a.id]; if (!sheet) continue;
      const { img, cell, footPad } = sheet;
      const seated = isSeated(a);
      const walking = a.mode === 'walk';
      const row = seated ? 4 : (ROW[a.dir] || 0);
      const col = seated ? (Math.floor(a.anim * 2) % 3) : (walking ? 1 + (Math.floor(a.anim * 6) % 2) : 0);
      const scale = SPR / cell, size = Math.round(cell * scale * s);
      const ax = a.x * T + 8, feet = a.y * T + 15 - (seated ? SIT_LIFT : 0);
      const dx = Math.round((ax - (cell / 2) * scale) * s);
      const dy = Math.round((feet - (cell - footPad) * scale) * s);
      dctx.imageSmoothingEnabled = false;
      dctx.drawImage(img, col * cell, row * cell, cell, cell, dx, dy, size, size);
    }
    // 高負載：冒汗（世界座標 → 畫布座標）
    for (const a of sorted) if (a.fx.sweat && a.mode === 'stay') {
      const ph = (now / 600 + a.anim) % 1, bx = (a.x * T + 14) * s, by = (a.y * T - 6 + ph * 6) * s;
      dctx.fillStyle = `rgba(127,211,255,${1 - ph})`; dctx.fillRect(Math.round(bx), Math.round(by), Math.max(2, Math.round(s * 1.4)), Math.max(3, Math.round(s * 2.2)));
      dctx.fillRect(Math.round(bx - 7 * s), Math.round(by + 2 * s), Math.max(2, Math.round(s * 1.2)), Math.max(2, Math.round(s * 1.8)));
    }
    overlay(now);
  }

  function overlay(now) {
    const s = canvas.width / WW, css = canvas.clientWidth / WW || 1, dpr = canvas.width / (canvas.clientWidth || canvas.width);
    const fs = Math.max(8, Math.min(12, 5.4 * css)) * dpr;
    for (const r of C.rooms) {
      const cx = (r.x + r.w / 2) * T * s, y = (r.y + 0.15) * T * s;
      pill(dctx, r.name, cx, y, fs * 1.05, 'rgba(22,26,43,.88)', '#ffe08a');
      const info = roomInfo[r.id];
      if (info && info.text) {
        const box = pill(dctx, info.text, cx, y + fs * 1.6, fs * 0.82, 'rgba(10,13,24,.9)', '#d9f4e6', info.color || '#3ecf8e');
        if (typeof info.pct === 'number') {   // 月預算水位線
          const bw = box.w, bx = box.x, by = y + fs * 1.6 + box.h + 1;
          R(dctx, Math.round(bx), Math.round(by), Math.round(bw), Math.max(2, Math.round(fs * 0.28)), '#1b2133');
          R(dctx, Math.round(bx), Math.round(by), Math.max(1, Math.round(bw * Math.min(100, info.pct) / 100)), Math.max(2, Math.round(fs * 0.28)), info.color || '#3ecf8e');
        }
      }
    }
    // 機房機櫃名牌
    if (showLabels) for (const f of C.furniture) if (f.type === 'poolrack') {
      const p = pools[f.pool]; const lab = (p && p.short) || f.pool;
      pill(dctx, lab, (f.x + f.w / 2) * T * s, (f.y + f.h) * T * s + 1, fs * 0.62, 'rgba(10,13,24,.85)', '#c9d0e6', TIER_LED[p ? (p.stale ? 'stale' : p.tier) : 'na']);
    }
    for (const f of arcades) {   // 街機名牌：滑過時顯示完整提示
      const ax = (f.x + f.w / 2) * T * s, ay = (f.y - 0.55) * T * s;
      if (arcadeHover === f) pill(dctx, (f.label || '小遊戲') + ' ▶ 點我玩', ax + 3 * T * s / 2, ay - fs * 0.6, fs * 0.95, '#ffd65a', '#1a1a1a', '#7a5cc8', '#1a1a1a');
      else if (showLabels) pill(dctx, '街機', ax, ay - fs * 0.1, fs * 0.7, 'rgba(58,42,110,.92)', '#ffe08a', '#ffd65a');
    }
    const sorted = agents.slice().sort((a, b) => a.y - b.y);
    for (const a of sorted) {
      const cx = (a.x * T + 8) * s, sel = a.id === selectedId;
      if (showLabels || sel) pill(dctx, a.cfg.short, cx, (a.y * T + 15) * s, fs * 0.92, sel ? '#ffd65a' : 'rgba(15,18,32,.82)', sel ? '#1a1a1a' : '#fff', null, sel ? '#1a1a1a' : null);
      const top = (a.y * T - 10) * s - fs * 1.4;
      if (a.say) pill(dctx, a.say.text, cx, top - fs * 0.2, fs * 0.92, '#ffffff', '#1a1a2a', null, '#1a1a2a');
      else if (a.state === 'charge') iconPill(dctx, 'battery', '充電中', cx, top, fs * 0.82, '#ff9d3b');
      else if (a.state === 'visit' && a.mode === 'stay') iconPill(dctx, 'mail', '交接任務', cx, top, fs * 0.82, '#ffd65a');
      else if (a.fx.active && atSeat(a) && a.cfg.icon) iconPill(dctx, a.cfg.icon, (showLabels || sel) ? (a.fx.turbo ? '全速' : '工作中') : '', cx, top, fs * 0.82, a.fx.turbo ? '#ff9d3b' : '#4cd964');
      else if (showLabels || sel) { const st = statusOf(a); pill(dctx, st.label, cx, top, fs * 0.82, 'rgba(15,18,32,.78)', '#e8ecf5', st.color); }
    }
    if (mapBanner) pill(dctx, mapBanner, canvas.width / 2, canvas.height - fs * 2.2, fs * 1.05, 'rgba(60,40,0,.92)', '#ffe08a', '#ffd65a', '#ffd65a');
    if (paused) pill(dctx, '⏸ 已暫停', canvas.width / 2, canvas.height / 2 - fs, fs * 1.6, 'rgba(0,0,0,.7)', '#fff');
  }

  // 主迴圈：最多 30 fps；分頁在背景時完全停下，省電
  let last = performance.now(), lastDraw = 0, active = true, rafId = 0;
  const FRAME_MS = 1000 / 30;
  function loop(now) {
    rafId = 0;
    if (!active) return;
    rafId = requestAnimationFrame(loop);
    if (now - lastDraw < FRAME_MS - 2) return;
    lastDraw = now;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) agents.forEach(a => update(a, dt));
    render(now);
    frameHooks.forEach(fn => fn());
  }
  function setActive(on) {
    active = !!on;
    if (active && !rafId && canvas) { last = performance.now(); rafId = requestAnimationFrame(loop); }
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
  const arcades = C.furniture.filter(f => f.type === 'arcade');
  let arcadeHover = null;
  const arcadeHooks = [];
  function arcadeAt(clientX, clientY, touch) {
    const rect = canvas.getBoundingClientRect();
    const wx = (clientX - rect.left) / rect.width * WW, wy = (clientY - rect.top) / rect.height * WH, pad = touch ? 5 : 1;
    return arcades.find(f => wx >= f.x * T - pad && wx <= (f.x + f.w) * T + pad && wy >= f.y * T - 8 - pad && wy <= (f.y + f.h) * T + pad) || null;
  }
  function select(id, from) { selectedId = id; selectHooks.forEach(fn => fn(id, from)); }
  function init(el) {
    canvas = el; dctx = canvas.getContext('2d');
    new ResizeObserver(resize).observe(canvas); resize();
    canvas.addEventListener('pointerup', e => {
      const a = hitTest(e.clientX, e.clientY, e.pointerType !== 'mouse');
      if (a) { select(a.id, 'map'); return; }
      const f = arcadeAt(e.clientX, e.clientY, e.pointerType !== 'mouse');
      if (f) arcadeHooks.forEach(fn => fn(f));
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const a = hitTest(e.clientX, e.clientY, false), f = a ? null : arcadeAt(e.clientX, e.clientY, false);
      arcadeHover = f;
      canvas.style.cursor = a || f ? 'pointer' : 'default';
      canvas.title = f ? '點一下開啟小遊戲「' + (f.label || '小遊戲') + '」' : '';
    });
    canvas.addEventListener('pointerleave', () => { arcadeHover = null; canvas.style.cursor = 'default'; });
    rafId = requestAnimationFrame(loop);
  }
  // 交接：走到目標同事的座位旁停 2 秒，再回來
  function visit(id, toId, o) {
    const a = byId[id], b = byId[toId]; if (!a || !b) return false;
    const seat = b.cfg.seat;
    const cand = [[seat[0] + 1, seat[1]], [seat[0] - 1, seat[1]], [seat[0], seat[1] + 1], [seat[0] + 1, seat[1] + 1], [seat[0] - 1, seat[1] + 1]];
    const t = freeFrom(cand, a); if (!t) return false;
    a.visitTo = toId; a.faceTo = seat;
    setState(a, 'visit', (o && o.stay) || 2, { target: t, onArrive: o && o.onArrive });
    return true;
  }

  window.Office = {
    init, setActive, agents, byId, statusOf, activityOf, STATUS, seats,
    select, getSelected: () => selectedId,
    onSelect: fn => selectHooks.push(fn), onFrame: fn => frameHooks.push(fn), onArcade: fn => arcadeHooks.push(fn),
    setState: (id, st, stay, o) => byId[id] && setState(byId[id], st, stay, o),
    setAll: (st, stay) => agents.forEach(a => { a.manual = Date.now() + (stay || 20) * 1000; setState(a, st, stay); }),
    setBrain: fn => { brain = fn; },
    replan: id => { const a = byId[id]; if (a && !a.manual && a.state !== 'visit') replan(a); },
    replanAll: () => agents.forEach(a => { if (!a.manual && a.state !== 'visit') replan(a); }),
    visit,
    setFx: (id, fx) => { if (byId[id]) byId[id].fx = fx || {}; },
    setPools: list => { pools = {}; (list || []).forEach(p => { pools[p.id] = p; }); },
    setRoomInfo: (id, info) => { roomInfo[id] = info; },
    setMapBanner: t => { mapBanner = t || null; },
    say: (id, text, ms) => { if (byId[id]) byId[id].say = { text, until: Date.now() + (ms || 2500) }; },
    togglePause: () => (paused = !paused),
    isPaused: () => paused,
    toggleLabels: () => (showLabels = !showLabels),
    isSeated: id => byId[id] && atSeat(byId[id]),
    screenPos: id => { const a = byId[id]; if (!a || !canvas) return null; const k = canvas.clientWidth / WW; return { x: (a.x * T + 8) * k, y: (a.y * T) * k }; },
    debug: { grid, walkable, bfs, roomAt, hallTiles },
  };
})();
