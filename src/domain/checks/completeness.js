// Completeness: things that must be accounted for before filing, and obligations
// outside this return that the records imply. These are not errors in the return.

import { makeResult, usd, qty, shortLabel, humanize } from './result.js';

/** Documents none of whose observations reach the return, and that have no disposition. */
function unaccountedDocuments(ctx, prior) {
  const disposed = new Set(ctx.matched.dispositions.map((d) => d.doc_id));
  const cited = new Set([...ctx.lines.flatMap((l) => l.sources), ...ctx.diagnostics.flatMap((g) => g.refs)]);
  const usedFacts = new Set(ctx.matched.facts.filter((f) => f.members.some((m) => cited.has(m.obs))).map((f) => f.id));
  const out = [];
  for (const d of ctx.packet.documents) {
    if (disposed.has(d.id)) continue;
    const obs = ctx.packet.observations.filter((o) => o.doc_id === d.id);
    const reaches = obs.some((o) => usedFacts.has(ctx.factOfObs.get(o.id)?.fact.id));
    if (reaches) continue;
    const usedByChecks = prior.filter((r) => r.evidence.some((e) => obs.some((o) => o.id === e) || e === `doc:${d.id}`)).map((r) => r.id);
    out.push(makeResult(ctx, {
      kind: 'completeness', check: 'document_unaccounted', subject: d.id,
      title: `${d.title}: not used on the return`,
      message: `No value from ${d.id} reaches a return line.`
        + (usedByChecks.length ? ` It is evidence for ${usedByChecks.join(', ')}.` : ' Record why (e.g. engagement record, identity verification, prior-year reference).'),
      evidence: [d.id], facts: [], recommendation: usedByChecks.length
        ? { treatment: 'Resolve the findings that rely on it', rationale: 'Its values change the return.' }
        : { treatment: 'Record a disposition', rationale: `A ${d.document_type.replace(/_/g, ' ')} supports the engagement, not a return line.` },
    }));
  }
  return out;
}

/** Every engine diagnostic must be resolved; link it to the findings that cover it. */
function engineDiagnostics(ctx, prior) {
  return ctx.diagnostics.map((g) => {
    const covered = prior.filter((r) => g.refs.some((ref) => r.evidence.includes(ref) || r.lines.includes(`${ctx.version}|${ref}`) || r.facts.some((f) => f.includes(ref))));
    return makeResult(ctx, {
      kind: 'completeness', check: 'engine_diagnostic', subject: g.code,
      title: `Engine ${g.severity}: ${humanize(g.code)}`,
      message: g.message + (covered.length ? ` Covered by ${covered.map((r) => r.id).join(', ')}.` : ''),
      evidence: g.refs, blocking: g.severity === 'warning',
      recommendation: covered.length ? { treatment: 'Resolve with the linked findings' } : { treatment: g.severity === 'info' ? 'Acknowledge' : 'Resolve and document' },
    });
  });
}

/** Lines that moved from last year by more than the firm's variance threshold need an explanation. */
function priorYearVariances(ctx, prior) {
  const rule = ctx.standards.variance_review;
  const py = ctx.packet.raw.prior_years.return_2024.lines;
  const out = [];
  for (const [key, before] of Object.entries(py)) {
    const fmtV = (v) => (/miles/i.test(ctx.line(key)?.label ?? '') ? `${qty(v)} miles` : usd(v));
    const l = ctx.line(key);
    if (!l || typeof l.value !== 'number' || typeof before !== 'number') continue;
    const change = l.value - before;
    const pct = before === 0 ? Infinity : Math.abs(change / before) * 100;
    if (Math.abs(change) <= rule.and_over_amount || pct <= rule.flag_if_change_over_percent) continue;
    const related = prior.filter((r) => r.lines.includes(`${ctx.version}|${key}`)).map((r) => r.id);
    out.push(makeResult(ctx, {
      kind: 'completeness', check: 'prior_year_variance', subject: key, action: 'explanation',
      title: `${shortLabel(l.label)}: ${fmtV(before)} in 2024, ${fmtV(l.value)} in ${ctx.taxYear}`,
      message: `Changed by ${fmtV(change)} (${Number.isFinite(pct) ? `${Math.round(pct)}%` : 'from zero'}); the firm flags changes over `
        + `${rule.flag_if_change_over_percent}% and ${rule.and_over_amount}.${related.length ? ` Related findings: ${related.join(', ')}.` : ''}`,
      lines: [key], evidence: [`py:/return_2024/lines/${key}`, ...l.sources.slice(0, 5)],
      engine: l.value, expected: before,
    }));
  }
  return out;
}

const deadline = (ctx, re) => ctx.packet.raw.firm.deadlines.find((d) => re.test(d.what))?.date ?? null;
const excludedByEngagement = (ctx, re) => ctx.packet.pages.some((p) => ctx.doc(p.doc_id).document_type === 'engagement_letter' && /not included/i.test(p.printed_content) && re.test(p.printed_content));

function outsideFilings(ctx, prior) {
  const out = [];
  const fx = ctx.packet.raw.engine_reference.parameters.fx;
  // FBAR: aggregate foreign account maximum over 10,000 USD at any time.
  for (const o of ctx.packet.observations.filter((x) => /max/i.test(x.field ?? '') && /_sek$/i.test(x.field ?? ''))) {
    const usd = Math.round(o.value / fx.SEK[`${ctx.taxYear}_year_end`]);
    if (usd <= 10000) continue;
    out.push(makeResult(ctx, {
      kind: 'outside_filing', check: 'fbar', subject: o.doc_id,
      title: `FinCEN 114 (FBAR) for ${ctx.taxYear}`,
      message: `Maximum balance SEK ${o.value} = ${usd} USD at the year-end rate, over the 10,000 threshold.`
        + (excludedByEngagement(ctx, /FBAR|FinCEN/i) ? ' The engagement letter excludes it: tell the client in writing.' : ''),
      evidence: [o.id], due: deadline(ctx, /FBAR/i),
    }));
  }
  // Prior preparer's unresolved foreign-gift reporting (Form 3520).
  for (const [i, item] of (ctx.packet.raw.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer ?? []).entries()) {
    if (!/3520/.test(item)) continue;
    out.push(makeResult(ctx, {
      kind: 'outside_filing', check: 'form_3520', subject: `py-open-item-${i}`,
      title: 'Form 3520 for the foreign inheritance may never have been filed',
      message: `Prior preparer's open item: "${item}". The Swedish account was opened from the inheritance; penalties apply to late Forms 3520.`,
      evidence: [`py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/${i}`, ...ctx.packet.observations.filter((o) => ctx.doc(o.doc_id ?? '')?.document_type === 'foreign_bank_statement').slice(0, 1).map((o) => o.id)],
    }));
  }
  // Information returns the business owed but did not file.
  const filed = ctx.line('SchC.J');
  if (filed?.value === 'No' && ctx.line('SchC.I')?.value === 'Yes') {
    out.push(makeResult(ctx, {
      kind: 'outside_filing', check: 'forms_1099_nec', subject: 'SchC.J',
      title: 'Forms 1099-NEC for the studio\'s contractors were not filed',
      message: `The studio paid contractors 600 or more and filed no Forms 1099-NEC (${filed.sources.join(', ')}).`
        + (excludedByEngagement(ctx, /1099/) ? ' Outside the engagement: advise the client.' : ''),
      lines: ['SchC.I', 'SchC.J'], evidence: [...filed.sources, ...ctx.line('SchC.I').sources], due: deadline(ctx, /1099-NEC/i),
    }));
  }
  // A payment held for the wrong year needs a transfer request.
  for (const r of prior.filter((x) => x.check === 'payment_tax_year')) {
    out.push(makeResult(ctx, {
      kind: 'outside_filing', check: 'payment_transfer', subject: r.subject,
      title: 'Ask the agency to move a payment to this year',
      message: `${r.title}. Request a transfer to ${ctx.taxYear}; until it is confirmed, leave it off the return.`,
      evidence: r.evidence, facts: r.facts,
    }));
  }
  return out;
}

export const COMPLETENESS_CHECKS = [unaccountedDocuments, engineDiagnostics, priorYearVariances, outsideFilings];
