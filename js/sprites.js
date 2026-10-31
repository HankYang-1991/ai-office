/* 程序化像素角色（全部用 fillRect 畫，不使用任何外部圖檔） */
(function () {
  function R(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function shade(hex, amt) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const n = parseInt(c, 16), rgb = [n >> 16 & 255, n >> 8 & 255, n & 255];
    const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + rgb.map(v => f(v).toString(16).padStart(2, '0')).join('');
  }

  function accessories(ctx, a, g, dir) {
    const { cx, top, eyeY, chest } = g;
    const acc = a.accessories || [];
    const ex = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    for (const k of acc) {
      if (k === 'spike') {
        const c = shade(a.color, -0.15);
        R(ctx, cx - 1, top - 3, 2, 1, c); R(ctx, cx - 2, top - 2, 4, 1, c); R(ctx, cx - 3, top - 1, 6, 1, c);
      }
    }
    for (const k of acc) {
      switch (k) {
        case 'tie': if (dir !== 'up') { R(ctx, cx - 1, chest, 2, 4, '#c0392b'); R(ctx, cx - 1, chest, 2, 1, '#e74c3c'); } break;
        case 'glasses': if (dir !== 'up') { R(ctx, cx - 4 + ex, eyeY - 1, 3, 3, '#222'); R(ctx, cx + 1 + ex, eyeY - 1, 3, 3, '#222');
          R(ctx, cx - 3 + ex, eyeY, 1, 1, '#bfe6ff'); R(ctx, cx + 2 + ex, eyeY, 1, 1, '#bfe6ff'); R(ctx, cx - 1 + ex, eyeY, 2, 1, '#222'); } break;
        case 'beret': R(ctx, cx - 4, top - 1, 8, 2, '#c0392b'); R(ctx, cx - 3, top - 2, 6, 1, '#d9493a'); R(ctx, cx + 1, top - 3, 1, 1, '#c0392b'); break;
        case 'headphones': R(ctx, cx - 5, top - 1, 10, 1, '#2d2d38'); R(ctx, cx - 6, top + 1, 2, 4, '#ff6b6b'); R(ctx, cx + 4, top + 1, 2, 4, '#ff6b6b'); break;
        case 'camera': if (dir !== 'up') { R(ctx, cx - 3, chest, 6, 4, '#222'); R(ctx, cx - 1, chest + 1, 2, 2, '#7fd3ff'); R(ctx, cx + 1, chest - 1, 2, 1, '#444'); } break;
        case 'hardhat': R(ctx, cx - 4, top - 2, 8, 2, '#f4c20d'); R(ctx, cx - 5, top, 10, 1, '#d4a20d'); R(ctx, cx - 1, top - 3, 2, 1, '#f4c20d'); break;
        case 'pencil': R(ctx, cx + 4, top + 1, 1, 4, '#f1c40f'); R(ctx, cx + 4, top + 5, 1, 1, '#444'); break;
      }
    }
  }

  function human(ctx, a, ox, oy, dir, fr, walking) {
    const skin = a.skin || '#f1c39b', hair = a.hair || '#3a2a1a', shirt = a.color, pants = a.pants || '#2e3350';
    const l1 = walking && fr === 0 ? 2 : 3, l2 = walking && fr === 1 ? 2 : 3;
    R(ctx, ox + 3, oy + 13, 2, l1, pants); R(ctx, ox + 7, oy + 13, 2, l2, pants);
    R(ctx, ox + 2, oy + 8, 8, 6, shirt); R(ctx, ox + 2, oy + 13, 8, 1, shade(shirt, -0.3));
    R(ctx, ox + 1, oy + 9, 1, 4, skin); R(ctx, ox + 10, oy + 9, 1, 4, skin);
    R(ctx, ox + 3, oy + 2, 6, 6, skin);
    R(ctx, ox + 2, oy + 1, 8, 2, hair); R(ctx, ox + 2, oy + 3, 1, 3, hair); R(ctx, ox + 9, oy + 3, 1, 3, hair);
    if (dir === 'up') R(ctx, ox + 3, oy + 3, 6, 4, hair);
    else {
      const ex = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      R(ctx, ox + 4 + ex, oy + 5, 1, 1, '#1b1b1b'); R(ctx, ox + 7 + ex, oy + 5, 1, 1, '#1b1b1b');
      R(ctx, ox + 5 + ex, oy + 7, 2, 1, shade(skin, -0.2));
    }
    return { cx: ox + 6, top: oy + 1, eyeY: oy + 5, chest: oy + 8 };
  }

  function blob(ctx, a, ox, oy, dir, fr, walking) {
    const c = a.color, d = shade(c, -0.28), belly = shade(c, 0.4);
    const f1 = walking && fr === 0 ? 1 : 0, f2 = walking && fr === 1 ? 1 : 0;
    R(ctx, ox + 2, oy + 14 - f1, 3, 2, d); R(ctx, ox + 7, oy + 14 - f2, 3, 2, d);
    R(ctx, ox + 3, oy + 2, 6, 1, c); R(ctx, ox + 2, oy + 3, 8, 1, c); R(ctx, ox + 1, oy + 4, 10, 9, c); R(ctx, ox + 2, oy + 13, 8, 1, c);
    R(ctx, ox + 1, oy + 12, 10, 1, d); R(ctx, ox + 3, oy + 3, 2, 1, shade(c, 0.35));
    R(ctx, ox + 0, oy + 4, 1, 3, a.accent || d); R(ctx, ox + 11, oy + 4, 1, 3, a.accent || d);
    R(ctx, ox + 0, oy + 9, 1, 2, d); R(ctx, ox + 11, oy + 9, 1, 2, d);
    if (dir !== 'up') {
      const ex = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      R(ctx, ox + 3 + ex, oy + 9, 6, 3, belly);
      R(ctx, ox + 3 + ex, oy + 6, 1, 2, '#111'); R(ctx, ox + 8 + ex, oy + 6, 1, 2, '#111');
      R(ctx, ox + 4 + ex, oy + 8, 4, 1, d);
      R(ctx, ox + 2 + ex, oy + 8, 1, 1, '#f7a1b5'); R(ctx, ox + 9 + ex, oy + 8, 1, 1, '#f7a1b5');
    } else {
      R(ctx, ox + 5, oy + 12, 2, 2, d); // tail
    }
    return { cx: ox + 6, top: oy + 2, eyeY: oy + 7, chest: oy + 9 };
  }

  function robot(ctx, a, ox, oy, dir, fr, walking) {
    const l1 = walking && fr === 0 ? 2 : 3, l2 = walking && fr === 1 ? 2 : 3;
    R(ctx, ox + 3, oy + 13, 2, l1, '#6b7388'); R(ctx, ox + 7, oy + 13, 2, l2, '#6b7388');
    R(ctx, ox + 2, oy + 8, 8, 5, '#3a3f4f'); R(ctx, ox + 3, oy + 9, 6, 3, '#4a5166');
    R(ctx, ox + 5, oy + 10, 2, 1, '#7fffd4');
    R(ctx, ox + 1, oy + 9, 1, 3, '#9aa3b5'); R(ctx, ox + 10, oy + 9, 1, 3, '#9aa3b5');
    R(ctx, ox + 2, oy + 2, 8, 6, '#d5dbe6'); R(ctx, ox + 2, oy + 7, 8, 1, '#a9b1c2');
    R(ctx, ox + 6, oy - 1, 1, 3, '#9aa3b5'); R(ctx, ox + 6, oy - 2, 1, 1, '#ff5a5a');
    if (dir !== 'up') {
      const ex = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      R(ctx, ox + 3, oy + 4, 6, 2, '#151a2a');
      R(ctx, ox + 4 + ex, oy + 4, 1, 1, '#5ff'); R(ctx, ox + 7 + ex, oy + 4, 1, 1, '#5ff');
    } else R(ctx, ox + 4, oy + 4, 4, 2, '#b8c0cf');
    return { cx: ox + 6, top: oy + 2, eyeY: oy + 4, chest: oy + 8 };
  }

  function penguin(ctx, a, ox, oy, dir, fr, walking) {
    const f1 = walking && fr === 0 ? 1 : 0, f2 = walking && fr === 1 ? 1 : 0;
    const body = '#1f2430';
    R(ctx, ox + 3, oy + 14 - f1, 2, 2, '#f39c12'); R(ctx, ox + 7, oy + 14 - f2, 2, 2, '#f39c12');
    R(ctx, ox + 3, oy + 1, 6, 1, body); R(ctx, ox + 2, oy + 2, 8, 1, body); R(ctx, ox + 1, oy + 3, 10, 11, body);
    R(ctx, ox + 0, oy + 7, 1, 4, body); R(ctx, ox + 11, oy + 7, 1, 4, body);
    if (dir !== 'up') {
      const ex = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      R(ctx, ox + 3 + ex, oy + 7, 6, 7, '#f4f4f4'); R(ctx, ox + 4 + ex, oy + 6, 4, 1, '#f4f4f4');
      R(ctx, ox + 3 + ex, oy + 3, 2, 2, '#fff'); R(ctx, ox + 7 + ex, oy + 3, 2, 2, '#fff');
      R(ctx, ox + 4 + ex, oy + 4, 1, 1, '#111'); R(ctx, ox + 7 + ex, oy + 4, 1, 1, '#111');
      R(ctx, ox + 5 + ex, oy + 5, 2, 1, '#f39c12');
    }
    R(ctx, ox + 1, oy + 6, 10, 1, a.color); // 圍巾
    if (dir !== 'up') R(ctx, ox + 8, oy + 7, 2, 2, a.color);
    return { cx: ox + 6, top: oy + 1, eyeY: oy + 4, chest: oy + 8 };
  }

  const KINDS = { human, blob, robot, penguin };

  // px,py = 角色所站格子的左上角（世界像素）
  function draw(ctx, a, px, py, o) {
    o = o || {};
    const dir = o.dir || 'down', fr = o.frame || 0, walking = !!o.walking;
    const bx = Math.round(px), by = Math.round(py);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(bx + 3, by + 13, 10, 2); ctx.fillRect(bx + 4, by + 12, 8, 1);
    const ox = bx + 2, oy = by - 4 + (walking && fr ? -1 : 0);
    const g = (KINDS[a.kind] || human)(ctx, a, ox, oy, dir, fr, walking);
    accessories(ctx, a, g, dir);
  }

  const cache = {};
  function avatar(a, scale) {
    scale = scale || 4;
    const key = a.id + '@' + scale;
    if (cache[key]) return cache[key];
    const c = document.createElement('canvas'); c.width = 16; c.height = 20;
    draw(c.getContext('2d'), a, 0, 5, { dir: 'down' });
    const big = document.createElement('canvas'); big.width = 16 * scale; big.height = 20 * scale;
    const bctx = big.getContext('2d'); bctx.imageSmoothingEnabled = false;
    bctx.drawImage(c, 0, 0, big.width, big.height);
    return (cache[key] = big.toDataURL());
  }

  window.OfficeSprites = { draw, avatar, shade };
})();
