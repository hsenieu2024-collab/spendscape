// Tiny dependency-free SVG chart builders. Each returns an SVGElement.
// Hover tooltips are driven by data-tip attributes, handled once in app.js.

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}
const text = (x, y, str, attrs = {}) => { const t = el('text', { x, y, ...attrs }); t.textContent = str; return t; };

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map(m => m * exp).find(m => m >= v);
}

/** Stacked monthly bars. */
export function stackedBars({ months, series, colors, fmt, labelFor }) {
  const W = 720, H = 300, pad = { l: 56, r: 12, t: 12, b: 32 };
  const cats = Object.keys(series).sort((a, b) => series[b].reduce((x, y) => x + y) - series[a].reduce((x, y) => x + y));
  const totals = months.map((_, i) => cats.reduce((a, c) => a + series[c][i], 0));
  const max = niceMax(Math.max(...totals));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / months.length;
  const y = v => pad.t + ih - (v / max) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Monthly spending by category' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'gridline' }));
    svg.append(text(pad.l - 8, y(v) + 4, fmt(v, { maximumFractionDigits: 0 }), { class: 'axis', 'text-anchor': 'end' }));
  }
  months.forEach((m, i) => {
    let acc = 0;
    const x = pad.l + i * bw + bw * 0.18;
    const g = el('g', { class: 'bar' });
    for (const c of cats) {
      const v = series[c][i];
      if (!v) continue;
      g.append(el('rect', {
        x, width: bw * 0.64, y: y(acc + v), height: Math.max(0, y(acc) - y(acc + v)),
        fill: colors[c], 'data-tip': `${labelFor(m)} · ${c}: ${fmt(v)}`, 'data-cat': c,
      }));
      acc += v;
    }
    svg.append(g);
    svg.append(text(x + bw * 0.32, H - pad.b + 18, labelFor(m).slice(0, 3), { class: 'axis', 'text-anchor': 'middle' }));
  });
  return svg;
}

/** Donut chart of category totals. */
export function donut({ entries, colors, fmt, centerLabel }) {
  const S = 220, r = 88, inner = 58, cx = S / 2, cy = S / 2;
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, class: 'chart donut', role: 'img', 'aria-label': 'Spending by category' });
  let angle = -Math.PI / 2;
  const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  for (const [name, v] of entries) {
    const sweep = (v / total) * Math.PI * 2;
    const end = angle + Math.min(sweep, Math.PI * 2 - 1e-4);
    const large = sweep > Math.PI ? 1 : 0;
    const [x1, y1] = pt(r, angle), [x2, y2] = pt(r, end), [x3, y3] = pt(inner, end), [x4, y4] = pt(inner, angle);
    svg.append(el('path', {
      d: `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4}Z`,
      fill: colors[name], 'data-tip': `${name}: ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`, 'data-cat': name,
    }));
    angle += sweep;
  }
  svg.append(text(cx, cy - 4, fmt(total, { maximumFractionDigits: 0 }), { class: 'donut-total', 'text-anchor': 'middle' }));
  svg.append(text(cx, cy + 16, centerLabel, { class: 'axis', 'text-anchor': 'middle' }));
  return svg;
}

/** GitHub-style calendar heatmap of daily spend. */
export function calendarHeatmap({ daily, from, to, fmt }) {
  const cell = 12, gap = 3, step = cell + gap;
  const DAY = 86_400_000;
  const start = new Date(from + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday
  const end = new Date(to + 'T00:00:00Z');
  const weeks = Math.ceil((end - start) / DAY / 7) + 1;
  const W = 30 + weeks * step, H = 22 + 7 * step;

  // Quantile thresholds so one big purchase doesn't wash out the scale.
  const values = Object.values(daily).sort((a, b) => a - b);
  const q = p => values[Math.floor(p * (values.length - 1))] ?? 0;
  const thresholds = [q(0.25), q(0.5), q(0.75), q(0.92)];
  const level = v => (!v ? 0 : 1 + thresholds.filter(t => v > t).length);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart heatmap', role: 'img', 'aria-label': 'Daily spending calendar' });
  ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((d, i) => d && svg.append(text(0, 22 + i * step + 10, d, { class: 'axis small' })));
  let lastMonth = -1;
  for (let d = new Date(start), i = 0; d <= end; d = new Date(d.getTime() + DAY), i++) {
    const week = Math.floor(i / 7), dow = i % 7;
    const key = d.toISOString().slice(0, 10);
    const x = 30 + week * step;
    if (dow === 0 && d.getUTCMonth() !== lastMonth && d.getUTCDate() <= 7) {
      lastMonth = d.getUTCMonth();
      svg.append(text(x, 12, d.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' }), { class: 'axis small' }));
    }
    if (key < from) continue;
    const v = daily[key] ?? 0;
    svg.append(el('rect', {
      x, y: 22 + dow * step, width: cell, height: cell, rx: 2,
      class: `heat l${level(v)}`, 'data-tip': `${key}: ${v ? fmt(v) : 'no spending'}`,
    }));
  }
  return svg;
}

/** Horizontal bar list (HTML, easier to make accessible than SVG text). */
export function barList(items, { colors, fmt, label }) {
  const max = Math.max(...items.map(i => i.total), 1);
  const ul = document.createElement('ul');
  ul.className = 'barlist';
  for (const item of items) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="barlist-label"></span>
      <span class="barlist-track"><span class="barlist-fill"></span></span>
      <span class="barlist-value"></span>`;
    li.querySelector('.barlist-label').textContent = label(item);
    li.querySelector('.barlist-value').textContent = fmt(item.total);
    const fill = li.querySelector('.barlist-fill');
    fill.style.width = `${(item.total / max) * 100}%`;
    fill.style.background = colors[item.category];
    li.dataset.tip = `${item.count} transaction${item.count === 1 ? '' : 's'} · ${item.category}`;
    ul.append(li);
  }
  return ul;
}
