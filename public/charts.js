// Thư viện biểu đồ BI nhỏ, không phụ thuộc thư viện ngoài. Trả về chuỗi HTML/SVG.
window.UI = (() => {
  const PAL = ['#0B7F8F', '#FFB020', '#2BC0D2', '#3FCB8A', '#F2625A', '#8E7CFF', '#FF8A5B', '#8FA6B4'];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtBytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B');
  const num = (n) => Number(n || 0).toLocaleString('vi-VN');
  const col = (i) => PAL[i % PAL.length];
  const empty = (m) => `<div class="chart-empty">${esc(m || 'Chưa có dữ liệu')}</div>`;

  function donut(items, { size = 150, thick = 20, center = '', sub = '', colors, fmt = num } = {}) {
    items = items.filter((i) => i.value > 0);
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) return empty();
    const r = (size - thick) / 2, C = 2 * Math.PI * r;
    let off = 0;
    const segs = items.map((it, i) => {
      const len = (it.value / total) * C;
      const c = it.color || (colors && colors[i]) || col(i);
      const s = `<circle class="seg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${c}" stroke-width="${thick}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" style="--c:${C};--len:${len}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(it.label)}: ${fmt(it.value)} (${Math.round((it.value / total) * 100)}%)</title></circle>`;
      off += len; return s;
    }).join('');
    const legend = items.map((it, i) => `<li><i style="background:${it.color || (colors && colors[i]) || col(i)}"></i><span>${esc(it.label)}</span><b>${fmt(it.value)}</b></li>`).join('');
    return `<div class="donutbox"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="chart"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${thick}"/>${segs}
      <text x="50%" y="${sub ? '47%' : '52%'}" text-anchor="middle" class="dc-t">${esc(center)}</text>${sub ? `<text x="50%" y="63%" text-anchor="middle" class="dc-s">${esc(sub)}</text>` : ''}</svg><ul class="legend">${legend}</ul></div>`;
  }

  function bars(items, { h = 150, fmt = num, color } = {}) {
    if (!items.length) return empty();
    const W = Math.max(280, items.length * 46), max = Math.max(...items.map((i) => i.value), 1), bw = Math.min(30, (W / items.length) * 0.6);
    const g = items.map((it, i) => {
      const bh = Math.max(2, (it.value / max) * (h - 34)), x = (W / items.length) * i + (W / items.length - bw) / 2, y = h - 20 - bh;
      return `<g><rect class="bar" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="5" fill="${it.color || color || col(i)}" style="animation-delay:${i * 40}ms"><title>${esc(it.label)}: ${fmt(it.value)}</title></rect>
      <text x="${x + bw / 2}" y="${h - 6}" text-anchor="middle" class="ax">${esc(String(it.label).slice(0, 7))}</text><text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" class="vl">${fmt(it.value)}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${h}" class="chart bars" preserveAspectRatio="xMidYMid meet" style="width:100%;max-height:${h + 30}px">${g}</svg>`;
  }

  function hbars(items, { fmt = num, color } = {}) {
    if (!items.length) return empty();
    const max = Math.max(...items.map((i) => i.value), 1);
    return `<div class="hbars">${items.map((it, i) => `<div class="hb"><span class="l" title="${esc(it.label)}">${esc(it.label)}</span><span class="t"><i style="width:${Math.max(2, (it.value / max) * 100)}%;background:${it.color || color || col(i)};animation-delay:${i * 50}ms"></i></span><b>${fmt(it.value)}</b></div>`).join('')}</div>`;
  }

  function line(points, { h = 150, color = '#0B7F8F', fmt = num, max, unit = '' } = {}) {
    if (points.length < 2) return empty('Cần ít nhất 2 điểm dữ liệu');
    const W = 600, pl = 34, pr = 10, pt = 12, pb = 24, mx = max || Math.max(...points.map((p) => p.y), 1) * 1.15;
    const X = (i) => pl + (i / (points.length - 1)) * (W - pl - pr), Y = (v) => pt + (1 - v / mx) * (h - pt - pb);
    const pts = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`);
    const grid = [0, 0.5, 1].map((t) => { const y = pt + t * (h - pt - pb); return `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="gl"/><text x="${pl - 6}" y="${y + 3}" text-anchor="end" class="ax">${fmt(Math.round(mx * (1 - t)))}${unit}</text>`; }).join('');
    const lab = points.map((p, i) => (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1 ? `<text x="${X(i)}" y="${h - 6}" text-anchor="middle" class="ax">${esc(p.x)}</text>` : '')).join('');
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 ${W} ${h}" class="chart line" style="width:100%"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}
      <polygon points="${pl},${h - pb} ${pts.join(' ')} ${W - pr},${h - pb}" fill="url(#${id})"/><polyline class="ln" points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3.5" fill="${color}"><title>${esc(p.x)}: ${fmt(p.y)}${unit}</title></circle>`).join('')}${lab}</svg>`;
  }

  function spark(values, { w = 120, h = 34, color = '#0B7F8F' } = {}) {
    if (values.length < 2) return '<span class="mut">—</span>';
    const mx = Math.max(...values, 1), mn = Math.min(...values, 0);
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 6)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="chart"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="ln"/></svg>`;
  }

  function gauge(pct, { label = '', sub = '', warn = 70, bad = 85 } = {}) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const c = p >= bad ? 'var(--bad)' : p >= warn ? 'var(--warn)' : 'var(--ok)';
    return `<div class="gauge"><svg viewBox="0 0 120 76" width="150"><path d="M10 64 A50 50 0 0 1 110 64" pathLength="100" fill="none" stroke="var(--track)" stroke-width="12" stroke-linecap="round"/>
      <path class="gv" d="M10 64 A50 50 0 0 1 110 64" pathLength="100" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${p} 100" style="--p:${p}"/>
      <text x="60" y="60" text-anchor="middle" class="gt">${Math.round(p)}%</text></svg><div class="gl2">${esc(label)}</div>${sub ? `<div class="mut">${esc(sub)}</div>` : ''}</div>`;
  }

  // Phân trang: trả HTML; fn là tên hàm toàn cục nhận số trang
  function pager(total, page, size, fn) {
    const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return total ? `<div class="pager"><span class="mut">${num(total)} mục</span></div>` : '';
    const set = new Set([1, pages, page, page - 1, page + 1, page - 2, page + 2].filter((p) => p >= 1 && p <= pages));
    const arr = [...set].sort((a, b) => a - b); let out = '', prev = 0;
    arr.forEach((p) => { if (p - prev > 1) out += '<span class="pg-dots">…</span>'; out += `<button class="pg ${p === page ? 'on' : ''}" onclick="${fn}(${p})">${p}</button>`; prev = p; });
    return `<div class="pager"><button class="pg" ${page <= 1 ? 'disabled' : ''} onclick="${fn}(${page - 1})">‹</button>${out}<button class="pg" ${page >= pages ? 'disabled' : ''} onclick="${fn}(${page + 1})">›</button><span class="mut">Trang ${page}/${pages} · ${num(total)} mục</span></div>`;
  }

  function kpi(label, value, { color, sub, count = true } = {}) {
    const isNum = typeof value === 'number' && count;
    return `<div class="kpi"><span>${esc(label)}</span><b style="${color ? 'color:' + color : ''}" ${isNum ? `data-count="${value}"` : ''}>${isNum ? 0 : esc(value)}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`;
  }
  function countUp(root = document) {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const to = Number(el.dataset.count), t0 = performance.now(), d = 650;
      const f = (t) => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = num(Math.round(to * e)); if (k < 1) requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
  }
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'vừa xong'; if (s < 3600) return Math.floor(s / 60) + ' phút trước'; if (s < 86400) return Math.floor(s / 3600) + ' giờ trước'; if (s < 2592000) return Math.floor(s / 86400) + ' ngày trước'; if (s < 31536000) return Math.floor(s / 2592000) + ' tháng trước'; return Math.floor(s / 31536000) + ' năm trước'; };
  return { PAL, esc, fmtBytes, num, donut, bars, hbars, line, spark, gauge, pager, kpi, countUp, empty, ago, col };
})();
