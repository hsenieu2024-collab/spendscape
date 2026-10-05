import { loadTransactions, toCSV } from './csv.js';
import { CATEGORIES, CATEGORY_NAMES, categorizeAll, merchantLabel } from './categorize.js';
import {
  summarize, monthlyByCategory, byCategory, topMerchants, dailySpend,
  detectRecurring, detectAnomalies, buildInsights, fmtMoney, setCurrency, monthName,
} from './analyze.js';
import { stackedBars, donut, calendarHeatmap, barList } from './charts.js';
import { generateSampleCSV } from './sample.js';

const $ = sel => document.querySelector(sel);
const COLORS = Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.color]));
const PAGE = 50;

// Browser storage is a convenience only; the app works without it.
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

const state = {
  raw: [],
  txs: [],
  overrides: store.get('spendscape.overrides', {}),
  shown: PAGE,
};

// ---------- Loading ----------

function load(text) {
  try {
    state.raw = loadTransactions(text);
  } catch (err) {
    showError(err.message);
    return;
  }
  $('#error').hidden = true;
  $('#landing').hidden = true;
  $('#dashboard').hidden = false;
  $('#dashActions').hidden = false;
  recompute();
  window.scrollTo({ top: 0 });
}

function showError(msg) {
  const e = $('#error');
  e.textContent = msg;
  e.hidden = false;
}

function readFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => load(reader.result);
  reader.onerror = () => showError('Could not read that file.');
  reader.readAsText(file);
}

const dz = $('#dropzone');
$('#fileInput').addEventListener('change', e => readFile(e.target.files[0]));
dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));
$('#sampleBtn').addEventListener('click', () => load(generateSampleCSV()));
$('#resetBtn').addEventListener('click', () => {
  $('#dashboard').hidden = true;
  $('#dashActions').hidden = true;
  $('#landing').hidden = false;
  $('#fileInput').value = '';
});
$('#currency').value = store.get('spendscape.currency', 'EUR');
setCurrency($('#currency').value);
$('#currency').addEventListener('change', e => {
  setCurrency(e.target.value);
  store.set('spendscape.currency', e.target.value);
  render();
});
$('#exportBtn').addEventListener('click', () => {
  const csv = toCSV(state.txs.map(t => ({ ...t, merchant: merchantLabel(t.merchant) })), ['date', 'description', 'merchant', 'category', 'amount']);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'spendscape-categorised.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Analysis + rendering ----------

function recompute() {
  state.txs = categorizeAll(state.raw, state.overrides);
  state.shown = PAGE;
  render();
}

function render() {
  const txs = state.txs;
  const summary = summarize(txs);
  const monthly = monthlyByCategory(txs);
  const recurring = detectRecurring(txs);
  const anomalies = detectAnomalies(txs);

  $('#period').textContent = `${summary.count.toLocaleString()} transactions · ${summary.from} → ${summary.to}`;
  renderKpis(summary, recurring);

  const labelFor = ym => monthName(ym);
  $('#monthlyChart').replaceChildren(stackedBars({ ...monthly, colors: COLORS, fmt: fmtMoney, labelFor }));
  renderLegend(Object.keys(monthly.series));
  $('#donutChart').replaceChildren(donut({ entries: byCategory(txs), colors: COLORS, fmt: fmtMoney, centerLabel: 'total spent' }));
  $('#merchants').replaceChildren(barList(topMerchants(txs), { colors: COLORS, fmt: fmtMoney, label: m => merchantLabel(m.merchant) }));
  $('#heatmap').replaceChildren(calendarHeatmap({ daily: dailySpend(txs), from: summary.from, to: summary.to, fmt: fmtMoney }));

  const insights = buildInsights(txs, { recurring, anomalies, monthly });
  $('#insights').replaceChildren(...insights.map(i => {
    const li = document.createElement('li');
    li.className = i.tone;
    li.textContent = i.text;
    return li;
  }));

  renderRecurring(recurring);
  renderAnomalies(anomalies);
  renderCategoryFilter();
  renderTransactions();
}

function renderKpis(s, recurring) {
  const activeSubs = recurring.filter(r => r.active);
  const kpis = [
    { label: 'Income', value: fmtMoney(s.income), sub: `${fmtMoney(s.income / s.months)} / month` },
    { label: 'Spending', value: fmtMoney(s.expenses), sub: `${fmtMoney(s.avgMonthlySpend)} / month` },
    { label: 'Net saved', value: fmtMoney(s.net), tone: s.net >= 0 ? 'good' : 'bad', sub: `${(s.savingsRate * 100).toFixed(1)}% savings rate` },
    { label: 'Recurring', value: fmtMoney(activeSubs.reduce((a, r) => a + r.annualCost, 0)), sub: `${activeSubs.length} active · per year` },
  ];
  $('#kpis').replaceChildren(...kpis.map(k => {
    const div = document.createElement('div');
    div.className = 'kpi';
    div.innerHTML = `<div class="kpi-label"></div><div class="kpi-value ${k.tone ?? ''}"></div><div class="kpi-sub"></div>`;
    div.querySelector('.kpi-label').textContent = k.label;
    div.querySelector('.kpi-value').textContent = k.value;
    div.querySelector('.kpi-sub').textContent = k.sub;
    return div;
  }));
}

function renderLegend(cats) {
  const legend = $('#legend');
  legend.replaceChildren(...cats.map(c => {
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${COLORS[c]}"></i>`;
    b.append(c);
    b.addEventListener('mouseenter', () => highlight(c));
    b.addEventListener('focus', () => highlight(c));
    b.addEventListener('mouseleave', () => highlight(null));
    b.addEventListener('blur', () => highlight(null));
    b.addEventListener('click', () => { $('#catFilter').value = c; state.shown = PAGE; renderTransactions(); $('#txTable').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    return b;
  }));
}

function highlight(cat) {
  document.querySelectorAll('.chart').forEach(svg => {
    svg.classList.toggle('dim', !!cat);
    svg.querySelectorAll('[data-cat]').forEach(n => n.classList.toggle('hl', n.dataset.cat === cat));
  });
}

function cell(content, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  if (content instanceof Node) td.append(content); else td.textContent = content;
  return td;
}
function header(...cols) {
  const tr = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c.replace(/^#/, '');
    if (c.startsWith('#')) th.className = 'num';
    tr.append(th);
  }
  return tr;
}
function pill(category) {
  const span = document.createElement('span');
  span.className = 'pill';
  span.innerHTML = `<i style="background:${COLORS[category]}"></i>`;
  span.append(category);
  return span;
}
function badge(text, cls = '') {
  const span = document.createElement('span');
  span.className = `badge ${cls}`;
  span.textContent = text;
  return span;
}
function emptyRow(table, msg, cols) {
  const tr = document.createElement('tr');
  const td = cell(msg, 'empty');
  td.colSpan = cols;
  tr.append(td);
  table.append(tr);
}

function renderRecurring(list) {
  const table = $('#recurring');
  table.replaceChildren(header('Merchant', 'Category', 'Cadence', '#Charge', '#Per year', 'Next expected', 'Status'));
  if (!list.length) return emptyRow(table, 'No recurring charges detected.', 7);
  for (const r of list) {
    const tr = document.createElement('tr');
    const status = document.createElement('span');
    if (!r.active) status.append(badge('stopped', 'off'));
    else if (r.priceChange > 0) status.append(badge(`▲ ${fmtMoney(r.priceChange)}`, 'up'));
    else status.append(badge(`${Math.round(r.confidence * 100)}% sure`));
    tr.append(
      cell(merchantLabel(r.merchant)),
      cell(pill(r.category)),
      cell(r.cadence),
      cell(fmtMoney(r.amount), 'num'),
      cell(fmtMoney(r.annualCost), 'num'),
      cell(r.active ? r.nextDate : '—'),
      cell(status),
    );
    table.append(tr);
  }
  const active = list.filter(r => r.active);
  $('#recurringTotal').textContent = `${fmtMoney(active.reduce((a, r) => a + r.annualCost / 12, 0))} / month across ${active.length} active`;
}

function renderAnomalies(list) {
  const table = $('#anomalies');
  table.replaceChildren(header('Date', 'Description', 'Category', '#Amount', '#Typical', '#Multiple'));
  if (!list.length) return emptyRow(table, 'Nothing unusual. Every charge looks typical for its category.', 6);
  for (const a of list.slice(0, 10)) {
    const tr = document.createElement('tr');
    tr.append(cell(a.date), cell(a.description, 'desc'), cell(pill(a.category)), cell(fmtMoney(-a.amount), 'num'), cell(fmtMoney(a.typical), 'num'), cell(`${a.multiple}×`, 'num'));
    table.append(tr);
  }
}

function renderCategoryFilter() {
  const sel = $('#catFilter');
  const current = sel.value;
  const used = CATEGORY_NAMES.filter(c => state.txs.some(t => t.category === c));
  sel.replaceChildren(new Option('All categories', ''), ...used.map(c => new Option(c, c)));
  sel.value = used.includes(current) ? current : '';
}

function renderTransactions() {
  const q = $('#search').value.trim().toLowerCase();
  const cat = $('#catFilter').value;
  const rows = state.txs
    .filter(t => (!cat || t.category === cat) && (!q || t.description.toLowerCase().includes(q)))
    .slice()
    .reverse();

  const table = $('#txTable');
  table.replaceChildren(header('Date', 'Description', 'Category', '#Amount'));
  if (!rows.length) emptyRow(table, 'No matching transactions.', 4);
  for (const t of rows.slice(0, state.shown)) {
    const tr = document.createElement('tr');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Category for ${t.description}`);
    select.append(...CATEGORY_NAMES.map(c => new Option(c, c)));
    select.value = t.category;
    select.addEventListener('change', () => {
      state.overrides[t.merchant] = select.value;
      store.set('spendscape.overrides', state.overrides);
      const shown = state.shown;
      recompute();
      state.shown = shown;
      renderTransactions();
    });
    tr.append(cell(t.date), cell(t.description, 'desc'), cell(select), cell(fmtMoney(t.amount), `num ${t.amount > 0 ? 'pos' : ''}`));
    tr.querySelector('.desc').title = t.description;
    table.append(tr);
  }
  $('#moreBtn').hidden = rows.length <= state.shown;
}

$('#search').addEventListener('input', () => { state.shown = PAGE; renderTransactions(); });
$('#catFilter').addEventListener('change', () => { state.shown = PAGE; renderTransactions(); });
$('#moreBtn').addEventListener('click', () => { state.shown += PAGE; renderTransactions(); });

// ---------- Tooltip ----------

const tip = $('#tooltip');
document.addEventListener('pointerover', e => {
  const target = e.target.closest('[data-tip]');
  if (!target) { tip.hidden = true; return; }
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
});
document.addEventListener('pointermove', e => {
  if (tip.hidden) return;
  const x = Math.min(Math.max(e.clientX, tip.offsetWidth / 2 + 8), innerWidth - tip.offsetWidth / 2 - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY}px`;
});
document.addEventListener('pointerleave', () => { tip.hidden = true; });

// Deep link: ?demo opens straight into the sample dashboard (handy for portfolio links).
if (new URLSearchParams(location.search).has('demo')) load(generateSampleCSV());
