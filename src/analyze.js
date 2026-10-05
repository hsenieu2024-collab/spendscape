// Pure analysis functions over categorised transactions:
// { date: 'YYYY-MM-DD', description, amount, merchant, category }

const DAY_MS = 86_400_000;
const toDay = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;

export const median = xs => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const stdev = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Headline numbers. Transfers out are treated as spending. */
export function summarize(txs) {
  const income = txs.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const expenses = -txs.filter(t => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  const months = new Set(txs.map(t => t.date.slice(0, 7))).size || 1;
  return {
    income,
    expenses,
    net: income - expenses,
    savingsRate: income > 0 ? (income - expenses) / income : 0,
    months,
    avgMonthlySpend: expenses / months,
    count: txs.length,
    from: txs[0]?.date,
    to: txs[txs.length - 1]?.date,
  };
}

/** { months: ['2026-01', …], series: { Groceries: [..per month..], … } } for expenses only. */
export function monthlyByCategory(txs) {
  const months = [...new Set(txs.map(t => t.date.slice(0, 7)))].sort();
  const index = Object.fromEntries(months.map((m, i) => [m, i]));
  const series = {};
  for (const t of txs) {
    if (t.amount >= 0) continue;
    (series[t.category] ??= Array(months.length).fill(0))[index[t.date.slice(0, 7)]] += -t.amount;
  }
  return { months, series };
}

export function byCategory(txs) {
  const totals = {};
  for (const t of txs) if (t.amount < 0) totals[t.category] = (totals[t.category] ?? 0) - t.amount;
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

export function topMerchants(txs, n = 8) {
  const totals = {};
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const m = (totals[t.merchant] ??= { merchant: t.merchant, category: t.category, total: 0, count: 0 });
    m.total -= t.amount;
    m.count++;
  }
  return Object.values(totals).sort((a, b) => b.total - a.total).slice(0, n);
}

/** Map of 'YYYY-MM-DD' → total spent that day. */
export function dailySpend(txs) {
  const out = {};
  for (const t of txs) if (t.amount < 0) out[t.date] = (out[t.date] ?? 0) - t.amount;
  return out;
}

const CADENCES = [
  { name: 'weekly', days: 7, tolerance: 2, perYear: 52 },
  { name: 'monthly', days: 30.4, tolerance: 5, perYear: 12 },
  { name: 'quarterly', days: 91, tolerance: 10, perYear: 4 },
  { name: 'yearly', days: 365, tolerance: 15, perYear: 1 },
];

/**
 * Detect recurring charges: same merchant, regular interval, stable amount.
 * Returns subscriptions sorted by annual cost, each with a confidence in [0, 1].
 */
export function detectRecurring(txs, { minOccurrences = 3, maxAmountCv = 0.2 } = {}) {
  const groups = {};
  for (const t of txs) if (t.amount < 0) (groups[t.merchant] ??= []).push(t);

  const results = [];
  for (const [merchant, items] of Object.entries(groups)) {
    if (items.length < minOccurrences) continue;
    const days = items.map(t => toDay(t.date)).sort((a, b) => a - b);
    const gaps = days.slice(1).map((d, i) => d - days[i]).filter(g => g > 0);
    if (gaps.length < minOccurrences - 1) continue;

    const typicalGap = median(gaps);
    const cadence = CADENCES.find(c => Math.abs(typicalGap - c.days) <= c.tolerance);
    if (!cadence) continue;

    const amounts = items.map(t => -t.amount);
    const avg = mean(amounts);
    const cv = avg ? stdev(amounts) / avg : 1;
    if (cv > maxAmountCv) continue;

    const onSchedule = gaps.filter(g => Math.abs(g - cadence.days) <= cadence.tolerance).length / gaps.length;
    if (onSchedule < 0.6) continue;

    const last = items[items.length - 1];
    const lastDay = toDay(last.date);
    const nextDay = lastDay + Math.round(cadence.days);
    const latestDay = toDay(txs[txs.length - 1].date);
    const current = amounts.at(-1);
    results.push({
      merchant,
      category: last.category,
      cadence: cadence.name,
      amount: current,
      annualCost: Math.round(current * cadence.perYear * 100) / 100,
      occurrences: items.length,
      lastDate: last.date,
      nextDate: new Date(nextDay * DAY_MS).toISOString().slice(0, 10),
      // A charge that stopped appearing is probably cancelled already.
      active: latestDay - lastDay <= cadence.days + cadence.tolerance * 2,
      confidence: Math.round(Math.min(1, onSchedule * (1 - cv) * Math.min(1, items.length / 6)) * 100) / 100,
      // Price now vs. when we first saw it (catches quiet subscription price rises).
      priceChange: Math.abs(current - amounts[0]) > 0.01 ? Math.round((current - amounts[0]) * 100) / 100 : 0,
    });
  }
  return results.sort((a, b) => b.annualCost - a.annualCost);
}

/**
 * Flag unusually large expenses using a robust z-score (median / MAD), so a single huge
 * outlier can't hide itself by inflating the standard deviation. The baseline is the
 * merchant's own history when there is enough of it (a varying electricity bill is normal),
 * otherwise the category's.
 */
export function detectAnomalies(txs, { threshold = 3.5, minSamples = 5, minAmount = 20, minMultiple = 2.5 } = {}) {
  const byCat = {}, byMerchant = {};
  for (const t of txs) {
    if (t.amount >= 0) continue;
    (byCat[t.category] ??= []).push(-t.amount);
    (byMerchant[t.merchant] ??= []).push(-t.amount);
  }
  const baseline = amounts => {
    const med = median(amounts);
    const mad = median(amounts.map(a => Math.abs(a - med))) || mean(amounts) * 0.1 || 1;
    return { med, mad };
  };
  const catStats = Object.fromEntries(Object.entries(byCat).filter(([, a]) => a.length >= minSamples).map(([k, a]) => [k, baseline(a)]));
  const merchantStats = Object.fromEntries(Object.entries(byMerchant).filter(([, a]) => a.length >= minSamples).map(([k, a]) => [k, baseline(a)]));

  const out = [];
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const stats = merchantStats[t.merchant] ?? catStats[t.category];
    if (!stats) continue;
    const amt = -t.amount;
    const score = (0.6745 * (amt - stats.med)) / stats.mad;
    const multiple = amt / stats.med;
    if (score > threshold && amt >= minAmount && multiple >= minMultiple) {
      out.push({ ...t, score: Math.round(score * 10) / 10, typical: Math.round(stats.med * 100) / 100, multiple: Math.round(multiple * 10) / 10 });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Plain-language observations for the insights panel. */
export function buildInsights(txs, { recurring, anomalies, monthly }) {
  const insights = [];
  const s = summarize(txs);

  if (s.income > 0) {
    insights.push({
      tone: s.savingsRate >= 0.2 ? 'good' : s.savingsRate >= 0 ? 'neutral' : 'bad',
      text: `You kept ${(s.savingsRate * 100).toFixed(0)}% of your income${s.savingsRate >= 0.2 ? ' (above the common 20% guideline)' : s.savingsRate < 0 ? ' (spending exceeded income)' : ''}.`,
    });
  }

  const active = recurring.filter(r => r.active);
  if (active.length) {
    const yearly = active.reduce((a, r) => a + r.annualCost, 0);
    insights.push({ tone: 'neutral', text: `${active.length} active recurring charges add up to ${fmtMoney(yearly)} per year.` });
  }
  const raised = active.filter(r => r.priceChange > 0);
  for (const r of raised.slice(0, 2)) {
    insights.push({ tone: 'bad', text: `${titleCase(r.merchant)} has gone up by ${fmtMoney(r.priceChange)} since your first charge.` });
  }

  // Month-over-month category movers (last full month vs. average of earlier months).
  const { months, series } = monthly;
  if (months.length >= 3) {
    const lastIdx = months.length - 1;
    let biggest = null;
    for (const [cat, values] of Object.entries(series)) {
      // Only compare categories you spend on most months, not one-off payments.
      if (values.filter(v => v > 0).length < months.length * 0.6) continue;
      const prior = mean(values.slice(0, lastIdx));
      const delta = values[lastIdx] - prior;
      if (prior > 30 && (!biggest || Math.abs(delta) > Math.abs(biggest.delta))) biggest = { cat, delta, prior };
    }
    if (biggest && Math.abs(biggest.delta) / biggest.prior > 0.25) {
      const up = biggest.delta > 0;
      insights.push({
        tone: up ? 'bad' : 'good',
        text: `${biggest.cat} ${up ? 'rose' : 'fell'} ${Math.abs((biggest.delta / biggest.prior) * 100).toFixed(0)}% in ${monthName(months[lastIdx])} versus your average.`,
      });
    }
  }

  if (anomalies.length) {
    const a = anomalies[0];
    insights.push({ tone: 'bad', text: `Unusual: ${fmtMoney(-a.amount)} at ${titleCase(a.merchant)} on ${a.date}, about ${a.multiple}× the usual amount.` });
  }

  const weekend = txs.filter(t => t.amount < 0 && [0, 6].includes(new Date(t.date + 'T00:00:00Z').getUTCDay()));
  const weekendShare = -weekend.reduce((a, t) => a + t.amount, 0) / (s.expenses || 1);
  if (weekendShare > 0.4) insights.push({ tone: 'neutral', text: `${(weekendShare * 100).toFixed(0)}% of your spending happens on weekends.` });

  return insights;
}

let currency = 'EUR';
export function setCurrency(c) { currency = c; }
export function fmtMoney(n, opts = {}) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2, ...opts }).format(n);
}
export const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());
export const monthName = ym => new Date(ym + '-01T00:00:00Z').toLocaleString(undefined, { month: 'long', timeZone: 'UTC' });
