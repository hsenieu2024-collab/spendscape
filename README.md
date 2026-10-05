# Spendscape

**See where your money actually goes, without handing your bank data to anyone.**

Spendscape is a personal-finance dashboard that runs entirely in your browser. Drop in a CSV export from your bank and it will:

- **Categorise every transaction** with keyword rules for 100+ common merchants, and learn from your corrections.
- **Find your subscriptions**, including weekly, monthly, quarterly and yearly charges. It also notices ones that quietly got more expensive and ones you've already cancelled.
- **Flag unusual charges** using robust statistics, so one big purchase stands out instead of skewing the baseline.
- **Visualise your spending**: monthly stacked bars, category breakdown, top merchants, and a daily calendar heatmap.
- **Write plain-language insights**, like your savings rate, which categories are rising, and how much you spend on weekends.

🔗 **Live demo:** https://hsenieu2024-collab.github.io/spendscape/?demo

> 🔒 **Privacy by design.** There is no backend. Your file is read with the `FileReader` API and never leaves the tab. The only thing stored (in `localStorage`) is your category corrections.

---

## Why I built it

Banking apps show you a list of transactions. They rarely tell you that you're paying for three streaming services, that Netflix went up by €2, or that last month's dining bill was double your usual. Most tools that *do* answer those questions want you to connect your bank account to a third-party server. I wanted to see how far you can get with nothing but the browser and some careful statistics.

## How it works

```
CSV text ──► csv.js ──► categorize.js ──► analyze.js ──► charts.js / app.js
             parse +     merchant keys +    recurring,      SVG charts,
             normalise   rules + overrides  anomalies,      tables, UI
                                            insights
```

### 1. Parsing messy bank exports (`src/csv.js`)
Bank CSVs are inconsistent: commas or semicolons, `1,234.56` or `1.234,56`, `DD/MM/YYYY` or `MM/DD/YYYY`, one signed *Amount* column or separate *Debit*/*Credit* columns, and headers in English or Spanish. The parser:
- detects the delimiter from the header row (ignoring delimiters inside quotes),
- maps columns by matching header names (`Fecha`, `Concepto`, `Importe`, `Payee`, `Debit`, and so on),
- **infers the date order from the whole file**: if any first component is above 12 it must be the day,
- handles European/US number formats, currency symbols, `(40.00)` and trailing-minus negatives.

### 2. Merchant normalisation and categorisation (`src/categorize.js`)
`"CARD PAYMENT NETFLIX.COM 4829*** 12/03"` and `"NETFLIX.COM 5521"` should be the same merchant. `merchantKey()` strips card boilerplate, masked numbers, embedded dates and domains to build a stable key. Keyword rules then assign a category. When you change a category in the table, it's saved as an override for that merchant and applied to all its past and future transactions.

### 3. Recurring-charge detection (`src/analyze.js → detectRecurring`)
For each merchant with 3+ charges:
1. compute the gaps in days between consecutive charges and take the **median** gap,
2. match it to a cadence (weekly 7±2, monthly 30.4±5, quarterly 91±10, yearly 365±15),
3. require a stable amount (coefficient of variation ≤ 20%) and ≥ 60% of gaps on schedule,
4. mark it **stopped** if the next expected charge is overdue, and flag **price changes** since the first charge.

Each detection gets a confidence score based on schedule regularity, amount stability and history length.

### 4. Anomaly detection (`detectAnomalies`)
Uses the **modified z-score** (Iglewicz & Hoaglin): `0.6745 × (x − median) / MAD`, flagging values above 3.5. Median and MAD are robust: a €1,299 laptop can't inflate the baseline enough to hide itself, which is exactly what happens with a mean/standard-deviation z-score. The baseline is the merchant's own history when there are 5+ charges (so a varying electricity bill is normal), otherwise the category's.

### 5. Charts (`src/charts.js`)
Hand-written SVG with no charting library: stacked bars, donut, horizontal bars and a GitHub-style calendar heatmap with **quantile-based colour buckets**, so one huge day doesn't wash out the rest of the year. Hovering a legend item highlights that category across every chart.

## Tech

- Vanilla JavaScript (ES modules), HTML and CSS. **Zero dependencies, zero build step.**
- Automatic light/dark theme, responsive down to phone width, keyboard-accessible drop zone.
- 18 unit and end-to-end tests with a tiny built-in runner, run in CI on every push via GitHub Actions.
- Deployed on GitHub Pages.

## Run it locally

```bash
git clone https://github.com/hsenieu2024-collab/spendscape.git
cd spendscape
python3 -m http.server 8000   # any static server works
# open http://localhost:8000          (app)
# open http://localhost:8000/tests/   (test suite in the browser)
```

Run the tests from the command line:

```bash
npm test        # Node 18+, no install needed
```

## Supported CSV formats

Any file with a header row containing a **date**, a **description**, and either an **amount** or **debit/credit** columns. Examples:

```csv
Date,Description,Amount
2026-03-01,MERCADONA MADRID,-42.10
```

```csv
Fecha;Concepto;Importe
01/03/2026;NOMINA ACME SL;2.650,00
```

```csv
Transaction Date,Payee,Debit,Credit
03/15/2026,Starbucks,4.50,
```

## Project structure

```
index.html         UI shell
styles.css         design tokens, light/dark themes, layout
src/csv.js         parsing + normalisation
src/categorize.js  merchant keys, rules, overrides
src/analyze.js     summaries, recurring detection, anomalies, insights
src/charts.js      SVG chart builders
src/sample.js      deterministic synthetic 12-month statement for the demo
src/app.js         state, rendering, interactions
tests/             test suite + Node and browser runners
```

## Roadmap

- Budget targets per category with progress bars
- Multi-file import (several accounts) with transfer de-duplication
- Forecast the next 3 months from recurring charges plus seasonal averages
- Optional on-device ML categoriser trained on your own corrections

## License

MIT
