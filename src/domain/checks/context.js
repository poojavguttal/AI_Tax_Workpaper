// Shared lookups for checks: lines of one engine version, which facts each line
// cites, tax-effect estimates and the firm's sign-off threshold.

export function buildContext(packet, matched, { version = 'v3' } = {}) {
  const v = packet.index.versions.get(version);
  const lines = packet.lines.filter((l) => l.version === version);
  const line = (key) => packet.index.lines.get(`${version}|${key}`);
  const factOfObs = new Map();
  for (const f of matched.facts) for (const m of f.members) factOfObs.set(m.obs, { fact: f, member: m });
  const factById = new Map(matched.facts.map((f) => [f.id, f]));

  // obs id -> lines that cite it
  const citedBy = new Map();
  for (const l of lines) for (const s of l.sources) citedBy.set(s, [...(citedBy.get(s) ?? []), l]);
  // lines whose inputs include this key (downstream lines)
  const consumers = new Map();
  for (const l of lines) for (const i of l.inputs) consumers.set(i, [...(consumers.get(i) ?? []), l]);

  const caPeriod = packet.periods.find((p) => p.kind === 'residency' && p.state === 'CA');
  const taxYear = packet.raw.household.tax_year;
  const rates = v.tax_effect_rates;
  const diagnostics = packet.diagnostics.filter((g) => g.version === version);
  const standards = packet.raw.firm.starter_standards;
  const partnerThreshold = Number(standards.rules.map((r) => r.match(/tax effect over ([\d,]+)/i)?.[1]).find(Boolean)?.replace(/,/g, '') ?? 1000);

  /**
   * Estimated tax change if a quantity in `category` changes by `change` dollars
   * (corrected minus engine). `caSource` uses the California-source rate, for items
   * that are wholly California-source (the README's rule for sales during CA residency).
   */
  const effect = (category, change, { caSource = false, federal = true } = {}) => ({
    federal: federal ? Math.round(change * rates[category].federal_per_dollar) : 0,
    california: Math.round(change * (caSource ? rates.ca_source_income : rates[category]).california_per_dollar),
    method: 'rates',
  });

  const obs = (id) => packet.index.observations.get(id);
  const doc = (id) => packet.index.documents.get(id);
  const isCaliforniaSource = (isoDate) => Boolean(isoDate && caPeriod && isoDate >= caPeriod.from && isoDate <= caPeriod.to);

  return {
    packet, matched, version, v, diagnostics, lines, line, factOfObs, factById, citedBy, consumers, rates, effect, taxYear, caPeriod,
    isCaliforniaSource, partnerThreshold, obs, doc, standards,
  };
}

/** Category for tax-effect rates, and whether the line is an expense of that category. */
export function lineCategory(key) {
  const [form, num] = key.split('.');
  if (form === 'SchB') return { category: 'interest', expense: false };
  if (form === 'SchC') {
    const n = parseInt(num, 10);
    return { category: 'schc_profit', expense: n >= 8 && n <= 30 };
  }
  if (form === 'SchA') return { category: 'itemized', expense: false };
  if (form === 'Sch1' && Number(num) >= 11) return { category: 'adjustment', expense: false };
  if (form === 'F1040' && num === '1a') return { category: 'wages', expense: false };
  return { category: 'ordinary_income', expense: false };
}
