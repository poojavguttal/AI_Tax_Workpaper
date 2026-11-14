// Small parsers for amounts and dates written in prose (client answers, printed pages).

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const DATE_PATTERNS = [/\b[A-Za-z]+ \d{1,2}, \d{4}\b/g, /\b\d{2}\/\d{2}\/\d{4}\b/g, /\b\d{4}-\d{2}-\d{2}\b/g];

/** All money-looking numbers in a string, e.g. "4,000" or "13,420.00". Dates and bare years are skipped. */
export function parseAmounts(text) {
  const out = [];
  const withoutDates = DATE_PATTERNS.reduce((s, re) => s.replace(re, ' '), String(text));
  for (const m of withoutDates.matchAll(/(?<![\d/-])\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?(?![\d/-])/g)) {
    const n = Number(m[1].replace(/,/g, '') + (m[2] ?? ''));
    if (!m[1].includes(',') && !m[2] && n >= 1900 && n <= 2100) continue; // a bare year
    out.push(n);
  }
  return out;
}

/** ISO dates written as "January 14, 2026", "01/14/2026" or "2026-01-14". */
export function parseDates(text) {
  const s = String(text);
  const out = [];
  for (const m of s.matchAll(/\b([A-Za-z]+) (\d{1,2}), (\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi >= 0) out.push(`${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`);
  }
  for (const m of s.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)) out.push(`${m[3]}-${m[1]}-${m[2]}`);
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(m[0]);
  return out;
}

export const daysBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** First significant word of a name, lowercased: "Pecan Federal Savings" -> "pecan". */
export const keyword = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).find((w) => w.length > 2) ?? '';

/** "account ending 7731" style account suffixes mentioned in a text. */
export const accountSuffixes = (text) => [...String(text).matchAll(/(?:account|acct)[^.;]*?ending (\d{3,6})/gi)].map((m) => m[1]);
