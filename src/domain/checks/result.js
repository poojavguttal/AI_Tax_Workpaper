// The shape every check returns. A result is always created open: a recommendation
// never closes it. Closing takes a recorded decision (or correction) plus the
// sign-off the firm's rules require (step 4 enforces this).

const n0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Plain-language helpers for titles and messages a reviewer reads. */
export const usd = (n) => (typeof n === 'number' ? `${n < 0 ? '-' : ''}$${n0.format(Math.abs(n))}` : String(n));
export const qty = (n) => n0.format(n);
export const shortDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8))}, ${iso.slice(0, 4)}` : String(iso));
export const shortLabel = (label) => String(label).replace(/\s*\([^)]*\)/g, '').replace(/ reported on Form \S+.*$/, '').replace(/ and points$/, '').trim();
export const humanize = (code) => code.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const KINDS = {
  error: 'Detected error: the evidence establishes a discrepancy with the return.',
  conflict: 'Unresolved conflict: the evidence disagrees, and a person must decide which to rely on.',
  judgment: 'Professional judgment: more than one treatment is defensible; a person must decide.',
  completeness: 'Completeness: something must be accounted for before filing.',
  outside_filing: 'Outside filing: an obligation beyond this return that the records imply.',
};

export function makeResult(ctx, r) {
  const effect = r.effect ?? { federal: 0, california: 0, method: 'none' };
  const largest = Math.max(Math.abs(effect.federal ?? 0), Math.abs(effect.california ?? 0),
    Math.abs(effect.federal_payments ?? 0), Math.abs(effect.california_payments ?? 0),
    ...(r.alternatives ?? []).map((a) => Math.max(Math.abs(a.effect?.federal ?? 0), Math.abs(a.effect?.california ?? 0))));
  const decision = r.kind === 'conflict' || r.kind === 'judgment';
  return {
    id: `${r.check}:${r.subject}`,
    check: r.check,
    kind: r.kind,
    subject: r.subject,
    title: r.title,
    message: r.message,
    status: 'open',
    blocking: r.blocking ?? r.kind !== 'outside_filing',
    lines: (r.lines ?? []).map((k) => `${ctx.version}|${k}`),
    facts: r.facts ?? [],
    evidence: r.evidence ?? [],
    engine: r.engine ?? null,
    expected: r.expected ?? null,
    effect,
    recommendation: r.recommendation ?? null,
    alternatives: r.alternatives ?? [],
    due: r.due ?? null,
    requires: {
      // errors are closed by a correction; conflicts and judgments by a recorded decision
      action: r.action ?? (r.kind === 'error' ? 'correction' : decision ? 'decision' : r.kind === 'completeness' ? 'disposition' : 'acknowledgement'),
      authority: r.kind === 'judgment', // the decision must cite the authority relied on (firm rule)
      signoff: largest > ctx.partnerThreshold ? 'partner' : 'reviewer',
    },
  };
}
