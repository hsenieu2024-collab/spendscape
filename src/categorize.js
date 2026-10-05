// Rule-based categorisation. Keyword rules first, then user overrides (by merchant) win.

export const CATEGORIES = {
  Income:        { color: '#2f9e6e', keywords: ['salary', 'payroll', 'nomina', 'nómina', 'refund', 'interest', 'dividend', 'transfer from', 'bizum from'] },
  Housing:       { color: '#5b6cf0', keywords: ['rent', 'alquiler', 'mortgage', 'hipoteca', 'landlord', 'community fee', 'ikea'] },
  Utilities:     { color: '#3aa0c8', keywords: ['electric', 'iberdrola', 'endesa', 'naturgy', 'water', 'gas ', 'internet', 'fibra', 'movistar', 'vodafone', 'orange', 'digi'] },
  Groceries:     { color: '#4caf50', keywords: ['mercadona', 'carrefour', 'lidl', 'aldi', 'dia ', 'supermarket', 'grocer', 'eroski', 'alcampo', 'whole foods', 'tesco'] },
  Dining:        { color: '#f08c3a', keywords: ['restaurant', 'cafe', 'café', 'coffee', 'starbucks', 'mcdonald', 'burger', 'pizza', 'glovo', 'just eat', 'uber eats', 'deliveroo', 'bar ', 'taberna', 'sushi'] },
  Transport:     { color: '#e0b030', keywords: ['uber', 'cabify', 'bolt', 'metro', 'renfe', 'emt', 'taxi', 'fuel', 'repsol', 'cepsa', 'parking', 'bicimad', 'lime'] },
  Travel:        { color: '#9c5ad6', keywords: ['airbnb', 'booking.com', 'ryanair', 'vueling', 'iberia', 'easyjet', 'hotel', 'airline', 'expedia'] },
  Shopping:      { color: '#d6568c', keywords: ['amazon', 'zara', 'h&m', 'primark', 'el corte ingles', 'corte inglés', 'decathlon', 'fnac', 'mediamarkt', 'apple store', 'shein', 'aliexpress'] },
  Subscriptions: { color: '#e05555', keywords: ['netflix', 'spotify', 'disney', 'hbo', 'prime video', 'youtube premium', 'icloud', 'chatgpt', 'claude', 'notion', 'adobe', 'patreon', 'xbox', 'playstation'] },
  Health:        { color: '#40b8a8', keywords: ['pharmacy', 'farmacia', 'gym', 'fitness', 'basic-fit', 'dentist', 'clinic', 'doctor', 'sanitas', 'adeslas'] },
  Education:     { color: '#7a8b99', keywords: ['university', 'tuition', 'coursera', 'udemy', 'books', 'casa del libro', 'school'] },
  Other:         { color: '#9aa3ad', keywords: [] },
};

export const CATEGORY_NAMES = Object.keys(CATEGORIES);

/**
 * Normalise a raw bank description into a stable merchant key, e.g.
 * "CARD PAYMENT NETFLIX.COM 4829*** AMSTERDAM 12/03" → "netflix amsterdam".
 */
export function merchantKey(description) {
  return description
    .toLowerCase()
    .replace(/\.(com|es|net|org|io|eu|co\.uk)\b/g, ' ')    // netflix.com → netflix
    .replace(/\b(card|payment|purchase|pos|compra|pago|tarjeta|debit|contactless|ref|txn|transaction|direct|transfer|transferencia)\b/g, ' ')
    .replace(/\d+[\/\-.]\d+([\/\-.]\d+)?/g, ' ') // embedded dates
    .replace(/[*#]+\w*/g, ' ')                   // masked card numbers / refs
    .replace(/\d{3,}/g, ' ')                       // long numbers
    .replace(/[^a-záéíóúñü&\s.]/g, ' ')
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 3)
    .join(' ') || description.toLowerCase().trim();
}

/** Pretty display name for a merchant key. */
export function merchantLabel(key) {
  return key.replace(/\b\w/g, c => c.toUpperCase());
}

export function categorize(tx, overrides = {}) {
  const key = merchantKey(tx.description);
  if (overrides[key]) return overrides[key];
  const text = ` ${tx.description.toLowerCase()} `;
  for (const [name, { keywords }] of Object.entries(CATEGORIES)) {
    if (name === 'Income' && tx.amount < 0) continue;
    if (keywords.some(k => text.includes(k))) return name;
  }
  return tx.amount > 0 ? 'Income' : 'Other';
}

export function categorizeAll(transactions, overrides = {}) {
  return transactions.map(tx => {
    const merchant = merchantKey(tx.description);
    return { ...tx, merchant, category: categorize(tx, overrides) };
  });
}
