// Runs the check library against one engine version. Results are always open;
// step 4's events and reducer are what close them.

import { buildContext } from './context.js';
import { ERROR_CHECKS } from './errors.js';
import { CONFLICT_CHECKS } from './conflicts.js';
import { JUDGMENT_CHECKS } from './judgments.js';
import { COMPLETENESS_CHECKS } from './completeness.js';

const ORDER = ['error', 'conflict', 'judgment', 'completeness', 'outside_filing'];
const size = (r) => Math.max(Math.abs(r.effect.federal ?? 0), Math.abs(r.effect.california ?? 0),
  Math.abs(r.effect.federal_payments ?? 0), Math.abs(r.effect.california_payments ?? 0));

export function runChecks(packet, matched, { version = 'v3' } = {}) {
  const ctx = buildContext(packet, matched, { version });
  const findings = [...ERROR_CHECKS, ...CONFLICT_CHECKS, ...JUDGMENT_CHECKS].flatMap((check) => check(ctx));
  // Completeness checks link back to the findings above.
  const rest = COMPLETENESS_CHECKS.flatMap((check) => check(ctx, findings));
  const results = [...findings, ...rest].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || size(b) - size(a) || (a.id < b.id ? -1 : 1));

  const errors = results.filter((r) => r.kind === 'error');
  const total = (key) => errors.reduce((s, r) => s + (r.effect[key] ?? 0), 0);
  return {
    version,
    results,
    summary: {
      byKind: Object.fromEntries(ORDER.map((k) => [k, results.filter((r) => r.kind === k).length])),
      blocking: results.filter((r) => r.blocking).length,
      // Errors alone, at the engine's per-dollar rates; decisions on conflicts and judgments move these further.
      errorEffect: { federal: total('federal'), california: total('california'), federal_payments: total('federal_payments'), california_payments: total('california_payments') },
    },
  };
}
