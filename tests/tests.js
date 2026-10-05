// Zero-dependency test suite. Runs in the browser (tests/index.html) or with Node: `node tests/run.mjs`.
import { parseCSV, parseAmount, parseDate, detectDateOrder, detectColumns, loadTransactions, toCSV } from '../src/csv.js';
import { categorize, categorizeAll, merchantKey } from '../src/categorize.js';
import { summarize, monthlyByCategory, detectRecurring, detectAnomalies, median } from '../src/analyze.js';
import { generateSampleCSV } from '../src/sample.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (actual, expected, msg = '') => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
};
const ok = (cond, msg = 'assertion failed') => { if (!cond) throw new Error(msg); };
const close = (a, b, eps = 0.01) => ok(Math.abs(a - b) < eps, `expected ≈${b}, got ${a}`);

// ---- CSV ----
test('parseCSV handles quotes, escaped quotes and CRLF', () => {
  eq(parseCSV('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});
test('parseCSV detects semicolon delimiter', () => {
  eq(parseCSV('Fecha;Concepto;Importe\n01/02/2026;Mercadona;-12,50'), [['Fecha', 'Concepto', 'Importe'], ['01/02/2026', 'Mercadona', '-12,50']]);
});
test('parseAmount handles US, EU, parentheses and trailing minus', () => {
  eq(parseAmount('1,234.56'), 1234.56);
  eq(parseAmount('1.234,56'), 1234.56);
  eq(parseAmount('-12,5'), -12.5);
  eq(parseAmount('(40.00)'), -40);
  eq(parseAmount('15.00-'), -15);
  eq(parseAmount('€ 9.99'), 9.99);
});
test('detectDateOrder infers from unambiguous samples', () => {
  eq(detectDateOrder(['2026-01-05']), 'ymd');
  eq(detectDateOrder(['01/02/2026', '25/02/2026']), 'dmy');
  eq(detectDateOrder(['01/02/2026', '02/25/2026']), 'mdy');
});
test('parseDate normalises to ISO', () => {
  eq(parseDate('5/3/26', 'dmy'), '2026-03-05');
  eq(parseDate('2026-11-30', 'ymd'), '2026-11-30');
  eq(parseDate('13/13/2026', 'dmy'), null);
});
test('detectColumns understands Spanish headers and debit/credit layouts', () => {
  eq(detectColumns(['Fecha', 'Concepto', 'Importe']), { date: 0, description: 1, amount: 2, debit: -1, credit: -1 });
  const c = detectColumns(['Date', 'Details', 'Debit', 'Credit']);
  eq([c.amount, c.debit, c.credit], [-1, 2, 3]);
});
test('loadTransactions with separate debit/credit columns', () => {
  const txs = loadTransactions('Date,Details,Debit,Credit\n2026-01-02,Coffee,3.50,\n2026-01-01,Salary,,2000');
  eq(txs.map(t => t.amount), [2000, -3.5]); // sorted by date
});
test('loadTransactions throws a helpful error on unknown layout', () => {
  let msg = '';
  try { loadTransactions('foo,bar\n1,2'); } catch (e) { msg = e.message; }
  ok(/date column/i.test(msg), msg);
});
test('toCSV escapes commas and quotes', () => {
  eq(toCSV([{ a: 'x,y', b: 'he said "hi"' }], ['a', 'b']), 'a,b\n"x,y","he said ""hi"""');
});

// ---- Categorisation ----
test('merchantKey strips card noise and numbers', () => {
  eq(merchantKey('CARD PAYMENT NETFLIX.COM 4829*** 12/03'), 'netflix');
  eq(merchantKey('SPOTIFY P2B7C9 STOCKHOLM'), 'spotify stockholm');
});
test('categorize uses keywords, sign, and overrides', () => {
  eq(categorize({ description: 'MERCADONA MADRID', amount: -20 }), 'Groceries');
  eq(categorize({ description: 'Unknown shop', amount: -5 }), 'Other');
  eq(categorize({ description: 'Unknown sender', amount: 50 }), 'Income');
  eq(categorize({ description: 'MERCADONA MADRID', amount: -20 }, { 'mercadona madrid': 'Dining' }), 'Dining');
});

// ---- Analysis ----
const mk = (date, description, amount, category = 'Other') => ({ date, description, amount, merchant: merchantKey(description), category });

test('median works for odd and even lengths', () => {
  eq(median([3, 1, 2]), 2);
  eq(median([4, 1, 3, 2]), 2.5);
});
test('summarize computes savings rate', () => {
  const s = summarize([mk('2026-01-01', 'Salary', 1000, 'Income'), mk('2026-01-02', 'Rent', -600)]);
  close(s.savingsRate, 0.4);
  eq(s.months, 1);
});
test('monthlyByCategory buckets expenses only', () => {
  const m = monthlyByCategory([mk('2026-01-01', 'a', -10, 'Dining'), mk('2026-02-01', 'b', -5, 'Dining'), mk('2026-02-03', 'pay', 100, 'Income')]);
  eq(m.months, ['2026-01', '2026-02']);
  eq(m.series, { Dining: [10, 5] });
});
test('detectRecurring finds monthly subscription and price rise', () => {
  const txs = ['01', '02', '03', '04', '05'].map((m, i) => mk(`2026-${m}-07`, 'NETFLIX.COM', i === 4 ? -15.99 : -13.99, 'Subscriptions'));
  const [r] = detectRecurring(txs, { maxAmountCv: 0.2 });
  eq(r.cadence, 'monthly');
  eq(r.amount, 15.99); // current price
  eq(r.annualCost, 191.88);
  close(r.priceChange, 2);
  eq(r.active, true);
});
test('detectRecurring ignores irregular merchants', () => {
  const txs = ['2026-01-01', '2026-01-03', '2026-02-20', '2026-02-21'].map(d => mk(d, 'ZARA', -40));
  eq(detectRecurring(txs).length, 0);
});
test('detectAnomalies flags a large outlier', () => {
  const txs = [12, 15, 9, 14, 11, 13, 10, 148].map((a, i) => mk(`2026-01-${String(i + 1).padStart(2, '0')}`, 'Glovo', -a, 'Dining'));
  const found = detectAnomalies(txs);
  eq(found.length, 1);
  eq(found[0].amount, -148);
});

// ---- End to end on sample data ----
test('sample data loads and produces sensible results', () => {
  const txs = categorizeAll(loadTransactions(generateSampleCSV()));
  ok(txs.length > 300, `only ${txs.length} transactions`);
  const recurring = detectRecurring(txs);
  const names = recurring.map(r => r.merchant);
  for (const expected of ['netflix', 'spotify stockholm', 'basic fit spain']) ok(names.includes(expected), `missing ${expected} in ${names}`);
  const disney = recurring.find(r => r.merchant.startsWith('disney'));
  ok(disney && !disney.active, 'Disney+ should be detected as stopped');
  ok(detectAnomalies(txs).some(a => a.description.includes('APPLE STORE')), 'Apple Store purchase should be flagged');
  const other = txs.filter(t => t.category === 'Other').length;
  ok(other / txs.length < 0.05, `${other} uncategorised`);
});

export async function runTests(log = console.log) {
  let passed = 0;
  const failures = [];
  for (const t of tests) {
    try { await t.fn(); passed++; log(`✓ ${t.name}`); }
    catch (e) { failures.push(t.name); log(`✗ ${t.name}\n    ${e.message}`); }
  }
  log(`\n${passed}/${tests.length} passed`);
  return { passed, failed: failures.length, failures };
}
