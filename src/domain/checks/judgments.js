// Professional judgment: more than one treatment is defensible. Each result gives
// the evidence, a recommendation with the authority behind it, and the alternatives
// with their effects. It stays open until a person decides and the reviewer (or
// partner, above the firm's threshold) signs off.

import { makeResult, usd } from './result.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DE_MINIMIS_PER_INVOICE = 2500; // Treas. Reg. 1.263(a)-1(f) safe harbor, taxpayers without an AFS
const STOP = new Set(['per', 'month', 'plan', 'with', 'from', 'total', 'lines']);
const words = (s) => String(s).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));

/** What-if results the engine already ran for a line, as alternatives. */
function whatIfFor(ctx, lineKey) {
  return ctx.packet.raw.what_if.alternatives.find((a) => a.changed_lines.some((c) => c.key === lineKey));
}
const whatIfEffect = (w) => ({ federal: w.federal.total_tax_change, california: w.california.total_tax_change, method: 'what_if' });

/** A large invoice on a rental expensed as a repair: repair or improvement? */
function repairOrImprovement(ctx) {
  const out = [];
  for (const inv of ctx.packet.documents.filter((d) => d.document_type === 'invoice' && ctx.matched.docActivity.get(d.id)?.startsWith('rental:'))) {
    const total = ctx.packet.observations.find((o) => o.doc_id === inv.id && /total/i.test(o.field) && isNum(o.value));
    if (!total || total.value <= DE_MINIMIS_PER_INVOICE) continue;
    const activity = ctx.matched.docActivity.get(inv.id);
    const line = ctx.lines.find((l) => /repairs/i.test(l.label) && l.sources.some((s) => {
      const o = ctx.obs(s);
      return o && ctx.matched.docActivity.get(o.doc_id) === activity
        && ctx.packet.observations.some((x) => x.doc_id === o.doc_id && x.value === total.value);
    }));
    if (!line) continue;
    const text = ctx.packet.pages.filter((p) => p.doc_id === inv.id).map((p) => p.printed_content).join(' ');
    // Call-note lines about the same work: they share several words with the invoice.
    const invoiceWords = new Set(words(text));
    const call = ctx.packet.raw.client.call_notes.flatMap((c) => c.notes.map((n, i) => ({ id: c.id, i, n })))
      .filter((x) => words(x.n).filter((w) => invoiceWords.has(w)).length >= 3);
    const w = whatIfFor(ctx, line.key);
    out.push(makeResult(ctx, {
      kind: 'judgment', check: 'repair_or_improvement', subject: `${line.key}:${inv.id}`,
      title: `${usd(total.value)} ${inv.issuer} invoice: repair or improvement?`,
      message: `${line.key} expenses ${usd(total.value)} from ${inv.id} as a repair. The invoice reads: "${text.slice(0, 160)}".`
        + (call.length ? ` Client call: "${call[0].n}"` : ''),
      lines: [line.key], evidence: [total.id, ...line.sources, ...call.map((c) => c.id)],
      engine: 'repair', expected: 'improvement',
      effect: w ? whatIfEffect(w) : undefined,
      recommendation: {
        alternative: w ? 1 : null,
        treatment: 'Capitalize as a building-system improvement (27.5-year residential rental property)',
        rationale: 'The whole HVAC system was replaced, not a component repaired: a restoration and a betterment of a building system.',
        authority: 'Treas. Reg. 1.263(a)-3(e)(2)(ii)(B)(1) (HVAC is a building system); 1.263(a)-3(k)(1)(vi) (replacement of a major component); 1.263(a)-1(f) de minimis limit 2,500 per invoice',
      },
      alternatives: [
        { treatment: 'Expense as a repair (as computed)', effect: { federal: 0, california: 0 } },
        ...(w ? [{ treatment: w.description, effect: whatIfEffect(w), what_if: w.id }] : []),
      ],
    }));
  }
  return out;
}

/** Self-employed health insurance claimed although the client says a spouse's employer plan was available. */
function seHealthEligibility(ctx) {
  const l = ctx.lines.find((x) => /R-SEHI/.test(x.rule ?? '') && x.value > 0);
  if (!l) return [];
  const q = ctx.packet.raw.client.questionnaire.find((x) => /eligible for health coverage/i.test(x.question) && /^yes/i.test(x.answer));
  if (!q) return [];
  const prior = ctx.packet.raw.prior_years.return_2024.notes?.[l.key];
  const disallow = ctx.effect('adjustment', -l.value);
  return [makeResult(ctx, {
    kind: 'judgment', check: 'se_health_eligibility', subject: l.key,
    title: 'Self-employed health insurance while eligible for an employer plan',
    message: `${l.key} deducts ${usd(l.value)}. ${q.id}: "${q.answer}"${prior ? ` The 2024 preparer disallowed it: "${prior}"` : ''}`,
    lines: [l.key], evidence: [q.id, ...l.sources, ...(prior ? [`py:/return_2024/notes/${l.key}`] : [])],
    engine: l.value, expected: 0, effect: disallow,
    recommendation: {
      alternative: 1,
      treatment: 'Disallow the deduction for every month Erik was eligible',
      rationale: 'No deduction for a month the taxpayer is eligible to participate in a subsidized plan of a spouse\'s employer. Confirm the employer plans were subsidized.',
      authority: 'IRC 162(l)(2)(B)',
    },
    alternatives: [
      { treatment: 'Keep the deduction (as computed)', effect: { federal: 0, california: 0 } },
      { treatment: 'Disallow (QBI and SEP interactions not included in the estimate)', effect: disallow },
    ],
  })];
}

/** Books expenses that the client says are partly or wholly personal. */
function mixedUseExpenses(ctx) {
  const sentences = ctx.packet.raw.client.call_notes.flatMap((c) => c.notes.map((n, i) => ({ ref: `${c.id}`, i, n, w: new Set(words(n)) })));
  const detailDocs = new Set(ctx.packet.documents.filter((d) => d.document_type === 'books_transaction_detail').map((d) => d.id));
  const ledger = ctx.packet.observations.filter((o) => ctx.packet.index.documents.get(o.doc_id)?.document_type === 'books_profit_loss' && isNum(o.value));
  const items = [];
  for (const o of ctx.packet.observations.filter((x) => detailDocs.has(x.doc_id) && isNum(x.value))) {
    const w = words(o.label);
    const best = sentences.map((s) => ({ s, score: w.filter((x) => s.w.has(x)).length })).filter((x) => x.score)
      .sort((a, b) => b.score - a.score)[0];
    if (!best) continue;
    const pct = /personal/i.test(best.s.n) ? 0 : Number(best.s.n.match(/(\d{1,3})%/)?.[1] ?? NaN) / 100;
    if (!Number.isFinite(pct)) continue;
    const annual = /per month/i.test(o.label) ? o.value * 12 : o.value;
    const page = ctx.packet.index.pages.get(`${o.doc_id}#${o.page}`).printed_content;
    const book = ledger.find((b) => b.value === annual) ?? ledger.find((b) => page.includes(b.field) && b.value >= annual);
    const line = book && ctx.lines.find((l) => l.form === 'SchC' && l.sources.includes(book.id));
    if (!line) continue;
    items.push({ o, annual, pct, disallowed: Math.round(annual * (1 - pct)), sentence: best.s, line, book });
  }
  if (!items.length) return [];
  const total = items.reduce((s, x) => s + x.disallowed, 0);
  const effect = ctx.effect('schc_profit', total);
  return [makeResult(ctx, {
    kind: 'judgment', check: 'mixed_use_expenses', subject: 'SchC',
    title: 'Business share of mixed-use expenses',
    message: items.map((x) => `${x.book.field} ${x.annual} at ${Math.round(x.pct * 100)}% business per ${x.sentence.ref} ("${x.sentence.n}"): disallow ${x.disallowed}`).join('; ')
      + `. Total ${total}; the engine deducts 100%.`,
    lines: [...new Set(items.map((x) => x.line.key))], evidence: [...new Set(items.flatMap((x) => [x.o.id, x.book.id, x.sentence.ref]))],
    engine: 0, expected: total, effect,
    recommendation: {
      alternative: 1,
      treatment: 'Deduct only the business share the client stated',
      rationale: 'Personal and family expenses are not deductible; mixed-use costs are allocated on a reasonable basis.',
      authority: 'IRC 162, 262; Cohan v. Commissioner, 39 F.2d 540 (2d Cir. 1930) for reasonable estimates',
    },
    alternatives: [
      { treatment: 'Deduct 100% (as computed)', effect: { federal: 0, california: 0 } },
      { treatment: 'Client-stated business percentages', effect },
    ],
  })];
}

/** SEP contribution above the deductible limit: withdraw the excess or pay the excise tax. */
function sepExcess(ctx) {
  const excess = ctx.v.carryovers_out.federal.sep_contribution_not_deductible_for_2025;
  const l = ctx.lines.find((x) => /R-SEP-LIMIT/.test(x.rule ?? ''));
  if (!l || !(excess > 0)) return [];
  const due = ctx.packet.raw.firm.deadlines.find((d) => /extended due date/i.test(d.what))?.date;
  const excise = Math.round(excess * 0.06);
  return [makeResult(ctx, {
    kind: 'judgment', check: 'sep_excess', subject: l.key,
    title: `SEP contribution exceeds the limit by ${usd(excess)}`,
    message: `${l.key}: ${l.note} The excess ${excess} is not deductible and carries a 6% excise tax each year it stays in the account.`,
    lines: [l.key], evidence: l.sources, engine: l.value, expected: l.value, due,
    effect: { federal: 0, california: 0, method: 'none', note: `6% excise ${excise} per year if not withdrawn` },
    recommendation: {
      alternative: 0,
      treatment: `Withdraw the excess and its earnings before ${due}`,
      rationale: 'A timely corrective distribution avoids the excise tax.',
      authority: 'IRC 4973; IRC 408(d)(4)',
    },
    alternatives: [
      { treatment: `Withdraw ${excess} plus earnings by ${due}`, effect: { federal: 0, california: 0 } },
      { treatment: 'Leave it in and file Form 5329', effect: { federal: excise, california: 0, note: 'per year' } },
    ],
  })];
}

/** Elections the engine priced that would lower tax (e.g. section 179 instead of bonus depreciation). */
function favorableElections(ctx) {
  const used = new Set(ctx.lines.flatMap((l) => (whatIfFor(ctx, l.key) && /repairs/i.test(l.label) ? [whatIfFor(ctx, l.key).id] : [])));
  return ctx.packet.raw.what_if.alternatives
    .filter((w) => !used.has(w.id) && Object.keys(w.choices ?? {}).length && w.federal.total_tax_change <= 0 && w.california.total_tax_change <= 0
      && (w.federal.total_tax_change < 0 || w.california.total_tax_change < 0))
    .map((w) => makeResult(ctx, {
      kind: 'judgment', check: 'election', subject: w.id,
      title: `Election available: ${w.description}`,
      message: `${w.description} Federal ${w.federal.total_tax_change}, California ${w.california.total_tax_change} (engine what-if on ${w.base_version}).`,
      lines: w.changed_lines.map((c) => c.key), evidence: [`what_if:${w.id}`],
      effect: whatIfEffect(w),
      recommendation: { alternative: 1, treatment: w.description, rationale: 'Lowers total tax with no federal cost.', authority: 'IRC 179; IRC 168(k); California does not conform to bonus depreciation' },
      alternatives: [{ treatment: 'Current method (as computed)', effect: { federal: 0, california: 0 } }, { treatment: w.description, effect: whatIfEffect(w), what_if: w.id }],
    }));
}

/** Engine limitations a preparer must compute by hand. */
function engineLimitations(ctx) {
  return ctx.diagnostics.filter((g) => /NOT_COMPUTED/.test(g.code)).map((g) => makeResult(ctx, {
    kind: 'judgment', check: 'engine_limitation', subject: g.code,
    title: g.message.split(':')[0],
    message: g.message,
    lines: g.refs.filter((r) => ctx.line(r)), evidence: g.refs,
    recommendation: { alternative: 0, treatment: 'Compute manually and attach the computation', rationale: 'The engine does not compute this.', authority: 'Cal. Rev. & Tax. Code 17062; FTB Schedule P (540NR) instructions' },
    alternatives: [
      { treatment: 'Computed manually; computation attached', effect: { federal: 0, california: 0, note: 'record any tax from the manual computation as an adjustment' } },
      { treatment: 'Not applicable (record why)', effect: { federal: 0, california: 0 } },
    ],
  }));
}

export const JUDGMENT_CHECKS = [repairOrImprovement, seHealthEligibility, mixedUseExpenses, sepExcess, favorableElections, engineLimitations];
