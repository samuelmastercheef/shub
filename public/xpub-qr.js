// Mã QR tự cài (chế độ byte, mức sửa lỗi M, phiên bản 1–40). Không thư viện ngoài, không gọi mạng. Chạy được trong Node để test.
(function (g) {
  'use strict';
  const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLK = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const dataCw = (v) => Math.floor(rawModules(v) / 8) - ECC[v] * BLK[v];
  const gmul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 255; };
  const rsDiv = (deg) => { const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1; for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = gmul(root, 2); } return r; };
  const rsRem = (data, div) => { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => (r[i] ^= gmul(c, f))); } return r; };
  const bit = (x, i) => ((x >>> i) & 1) !== 0;
  const alignPos = (v) => { if (v === 1) return []; const n = Math.floor(v / 7) + 2, size = v * 4 + 17, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, r = [6]; for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p); return r; };
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

  function encode(text) {
    const data = Array.from(new TextEncoder().encode(String(text)));
    let v = 1; for (; v <= 40; v++) { const cc = v < 10 ? 8 : 16; if (4 + cc + data.length * 8 <= dataCw(v) * 8) break; }
    if (v > 40) throw new Error('nội dung quá dài cho mã QR');
    const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(data.length, v < 10 ? 8 : 16); data.forEach((b) => put(b, 8));
    const cap = dataCw(v) * 8; put(0, Math.min(4, cap - bits.length)); put(0, (8 - (bits.length % 8)) % 8);
    for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
    const cws = []; for (let i = 0; i < bits.length; i += 8) cws.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    // sửa lỗi + xen kẽ khối
    const nb = BLK[v], el = ECC[v], raw = Math.floor(rawModules(v) / 8), nShort = nb - (raw % nb), sLen = Math.floor(raw / nb), div = rsDiv(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = cws.slice(k, k + sLen - el + (i < nShort ? 0 : 1)); k += d.length; const e = rsRem(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e)); }
    const all = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sLen - el || j >= nShort) all.push(b[i]); });
    // ma trận
    const size = v * 4 + 17, M = [...Array(size)].map(() => new Array(size).fill(false)), F = [...Array(size)].map(() => new Array(size).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); }
    const ap = alignPos(v), na = ap.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) { if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    const drawFormat = (mask) => {
      const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((d << 10) | r) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, bit(b, i)); set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i)); set(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const b = (v << 12) | r; for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); } }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert; if (!F[y][x] && i < all.length * 8) { M[y][x] = bit(all[i >>> 3], 7 - (i & 7)); i++; } } }
    // chọn mặt nạ có điểm phạt thấp nhất (luật chuỗi dài, khối 2x2, cân bằng sáng tối)
    const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
    const score = () => {
      let s = 0, dark = 0;
      for (let a = 0; a < size; a++) for (const row of [true, false]) { let run = 1; for (let b = 1; b < size; b++) { const c = row ? M[a][b] === M[a][b - 1] : M[b][a] === M[b - 1][a]; if (c) run++; else { if (run >= 5) s += run - 2; run = 1; } } if (run >= 5) s += run - 2; }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) s += 3; }
      for (const row of M) for (const c of row) if (c) dark++; return s + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let best = 0, bestS = Infinity;
    for (let m = 0; m < 8; m++) { apply(m); drawFormat(m); const s = score(); if (s < bestS) { bestS = s; best = m; } apply(m); }
    apply(best); drawFormat(best);
    return { version: v, size, modules: M };
  }
  function svg(text, { scale = 4, border = 4 } = {}) {
    const q = encode(text), n = q.size + border * 2; let p = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) p += `M${x + border},${y + border}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" shape-rendering="crispEdges" role="img"><rect width="100%" height="100%" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
  }
  const api = { encode, svg };
  g.SQr = api; if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
