// CSV parsing + bank-statement normalisation.
// Turns arbitrary bank exports into [{ date: 'YYYY-MM-DD', description, amount }].

/** RFC 4180-ish parser: handles quoted fields, escaped quotes, CRLF, and ; or , delimiters. */
export function parseCSV(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const c of firstLine) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

const COLUMN_PATTERNS = {
  date: /^(transaction\s*)?(date|fecha|datum|posted|booking)/i,
  description: /(desc|merchant|payee|concept|concepto|details|narrative|name|memo)/i,
  amount: /^(amount|importe|value|betrag|sum)/i,
  debit: /(debit|withdrawal|out|cargo)/i,
  credit: /(credit|deposit|in$|abono)/i,
};

/** Guess which column holds what, from header names. */
export function detectColumns(header) {
  const find = (re, exclude = []) =>
    header.findIndex((h, i) => re.test(h.trim()) && !exclude.includes(i));
  const date = find(COLUMN_PATTERNS.date);
  const description = find(COLUMN_PATTERNS.description, [date]);
  const amount = find(COLUMN_PATTERNS.amount, [date, description]);
  const debit = amount === -1 ? find(COLUMN_PATTERNS.debit, [date, description]) : -1;
  const credit = amount === -1 ? find(COLUMN_PATTERNS.credit, [date, description, debit]) : -1;

  if (date === -1) throw new Error('Could not find a date column. Expected a header like "Date".');
  if (description === -1) throw new Error('Could not find a description column (e.g. "Description", "Merchant").');
  if (amount === -1 && debit === -1 && credit === -1)
    throw new Error('Could not find an amount column (e.g. "Amount", or "Debit"/"Credit").');
  return { date, description, amount, debit, credit };
}

/** Parse "1,234.56", "1.234,56", "-12.00", "(12.00)", "€ 12", "12-" into a number. */
export function parseAmount(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  s = s.replace(/[^\d.,\-+]/g, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // European: 1.234,56 — or a bare "12,5"
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return negative ? -n : n;
}

/**
 * Decide the date order used by a file by looking at all of its date strings.
 * Returns 'ymd' | 'dmy' | 'mdy'.
 */
export function detectDateOrder(samples) {
  let firstOver12 = false, secondOver12 = false;
  for (const s of samples) {
    const parts = String(s).trim().split(/[\/\-.\s]/).map(Number);
    if (parts.length < 3) continue;
    if (String(s).trim().match(/^\d{4}/)) return 'ymd';
    if (parts[0] > 12) firstOver12 = true;
    if (parts[1] > 12) secondOver12 = true;
  }
  if (secondOver12 && !firstOver12) return 'mdy';
  return 'dmy'; // European default when ambiguous
}

export function parseDate(raw, order) {
  const s = String(raw).trim();
  const parts = s.split(/[\/\-.\sT]/).filter(Boolean);
  if (parts.length < 3) return null;
  let y, m, d;
  if (order === 'ymd') [y, m, d] = parts;
  else if (order === 'mdy') [m, d, y] = parts;
  else [d, m, y] = parts;
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Full pipeline: CSV text → normalised, date-sorted transactions. */
export function loadTransactions(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The file has no data rows.');
  const [header, ...data] = rows;
  const cols = detectColumns(header);
  const order = detectDateOrder(data.map(r => r[cols.date]));

  const out = [];
  for (const r of data) {
    const date = parseDate(r[cols.date], order);
    if (!date) continue;
    let amount;
    if (cols.amount !== -1) amount = parseAmount(r[cols.amount]);
    else {
      const debit = cols.debit !== -1 ? Math.abs(parseAmount(r[cols.debit]) || 0) : 0;
      const credit = cols.credit !== -1 ? Math.abs(parseAmount(r[cols.credit]) || 0) : 0;
      amount = credit - debit;
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    out.push({ date, description: (r[cols.description] ?? '').trim(), amount: Math.round(amount * 100) / 100 });
  }
  if (!out.length) throw new Error('No valid transactions found. Check the date and amount columns.');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function toCSV(rows, columns) {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map(r => columns.map(c => esc(r[c])).join(','))].join('\n');
}
