// Deterministic synthetic bank statement (12 months) so the demo works without real data.
// Emitted as CSV text so the demo exercises the same parsing path as an uploaded file.

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSampleCSV({ endDate = '2026-09-30', months = 12, seed = 42 } = {}) {
  const rand = mulberry32(seed);
  const pick = xs => xs[Math.floor(rand() * xs.length)];
  const between = (lo, hi) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;

  const end = new Date(endDate + 'T00:00:00Z');
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  const rows = [];
  const add = (d, description, amount) => {
    if (d < start || d > end) return;
    rows.push([d.toISOString().slice(0, 10), description, amount.toFixed(2)]);
  };

  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.getUTCDate();
    const dow = d.getUTCDay();
    const monthIdx = (d.getUTCFullYear() - start.getUTCFullYear()) * 12 + d.getUTCMonth() - start.getUTCMonth();

    // Monthly fixed items
    if (day === 1) add(d, 'TRANSFER RENT - ALQUILER CALLE PRINCIPE 12', -950);
    if (day === 28) add(d, 'NOMINA ACME CONSULTING SL PAYROLL', 2650);
    if (day === 3) add(d, 'IBERDROLA CLIENTES ELECTRIC BILL', -between(48, 95));
    if (day === 5) add(d, 'DIGI SPAIN TELECOM FIBRA', -30);
    if (day === 7) add(d, `CARD PAYMENT NETFLIX.COM ${4000 + day * 13}`, monthIdx >= 8 ? -15.99 : -13.99);
    if (day === 12) add(d, 'SPOTIFY P2B7C9 STOCKHOLM', -10.99);
    if (day === 2) add(d, 'BASIC-FIT SPAIN GYM MEMBERSHIP', -29.99);
    if (day === 18) add(d, 'ICLOUD STORAGE APPLE.COM/BILL', -2.99);
    if (day === 21 && monthIdx < 7) add(d, 'DISNEY PLUS SUBSCRIPTION', -9.99); // cancelled mid-year
    if (day === 15 && monthIdx % 3 === 0) add(d, 'MOVISTAR PLUS QUARTERLY', -24);
    if (day === 9 && monthIdx === 4) add(d, 'AMAZON PRIME ANNUAL MEMBERSHIP', -49.9);

    // Weekly-ish groceries
    if (dow === 6) add(d, pick(['MERCADONA MADRID', 'CARREFOUR EXPRESS', 'LIDL SUPERMERCADO']), -between(35, 85));
    if (dow === 3 && rand() < 0.6) add(d, 'DIA SUPERMERCADO', -between(8, 25));

    // Commuting
    if (dow >= 1 && dow <= 5 && rand() < 0.15) add(d, pick(['UBER TRIP HELP.UBER.COM', 'CABIFY MADRID', 'BOLT RIDE']), -between(6, 18));
    if (day === 1) add(d, 'METRO MADRID ABONO TRANSPORTE', -20);

    // Eating out — more at weekends
    const dineChance = dow === 5 || dow === 6 ? 0.55 : 0.18;
    if (rand() < dineChance) add(d, pick(['STARBUCKS GRAN VIA', 'GLOVO APP ORDER', 'TABERNA LA CANTABRA', 'SUSHI YA', 'PIZZA MARZANO', 'CAFE COMERCIAL']), -between(4, 42));

    // Shopping
    if (rand() < 0.06) add(d, pick(['AMAZON EU SARL', 'ZARA ESPANA', 'DECATHLON', 'FNAC CALLAO', 'PRIMARK GRAN VIA']), -between(15, 90));
    if (rand() < 0.03) add(d, 'FARMACIA LICENCIADO ROMERO', -between(5, 30));
    if (rand() < 0.02) add(d, 'BIZUM FROM LAURA GARCIA', between(10, 40));
  }

  // One-off events that make the dashboard interesting
  const at = (offsetMonths, day) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offsetMonths, day));
  add(at(2, 14), 'RYANAIR FLIGHT MAD-DUB', -142.6);
  add(at(2, 16), 'AIRBNB HMQ8X DUBLIN', -386.4);
  add(at(5, 22), 'APPLE STORE PUERTA DEL SOL', -1299);       // anomaly
  add(at(6, 3), 'UNIVERSITY TUITION INSTALLMENT', -1800);
  add(at(9, 10), 'VUELING AIRLINES BCN', -96.2);
  add(at(9, 11), 'HOTEL ARTS BOOKING.COM', -412);
  add(at(10, 20), 'GLOVO APP ORDER', -148.5);                // anomaly in dining
  add(at(11, 5), 'REFUND AMAZON EU SARL', 45.99);

  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return ['Date,Description,Amount', ...rows.map(r => `${r[0]},"${r[1]}",${r[2]}`)].join('\n');
}
