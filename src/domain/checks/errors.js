// Detected errors: the evidence establishes that the engine's line is wrong.

import { lineCategory } from './context.js';
import { makeResult, usd, qty, shortDate, shortLabel } from './result.js';
import { parseAmounts } from '../facts/text.js';

const near = (a, b, tol = 1) => Math.abs(a - b) < tol;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const COUNTED = new Set(['primary', 'part']);
const EXTRA = new Set(['duplicate', 'included_in']);

/** A line whose value is a non-money quantity (miles) is priced by the line that consumes it. */
function dollarize(ctx, l, amount) {
  if (ctx.obs(l.sources[0])?.value_type === 'money') return { line: l, dollars: amount };
  // The pricing line is the consumer that itself feeds a total (SchC.9 -> SchC.28), not a
  // sibling quantity such as "other miles".
  const consumer = (ctx.consumers.get(l.key) ?? [])
    .find((c) => isNum(c.value) && isNum(l.value) && l.value !== 0 && (ctx.consumers.get(c.key) ?? []).length);
  return consumer ? { line: consumer, dollars: Math.round(amount * (consumer.value / l.value)) } : { line: l, dollars: amount };
}

/** Change to the rate category's quantity when a line is overstated by `dollars`. */
function overstatementEffect(ctx, key, dollars) {
  const { category, expense } = lineCategory(key);
  return ctx.effect(category, expense ? dollars : -dollars);
}

/** One line adds an observation on top of the same fact it already counts (a duplicate, or an amount already included). */
function doubleCountedInLine(ctx) {
  const out = [];
  for (const l of ctx.lines) {
    if (!isNum(l.value) || l.sources.length < 2) continue;
    const cited = l.sources.map((s) => ({ s, o: ctx.obs(s), fm: ctx.factOfObs.get(s) })).filter((x) => x.o && isNum(x.o.value) && x.fm);
    for (const extra of cited.filter((x) => EXTRA.has(x.fm.member.role))) {
      const counted = cited.find((y) => y !== extra && y.fm.fact === extra.fm.fact && COUNTED.has(y.fm.member.role));
      if (!counted) continue;
      const amount = Number(extra.fm.member.value);
      const others = cited.filter((y) => y !== extra).map((y) => Number(y.o.value));
      const rest = l.value - amount;
      if (!(near(rest, sum(others)) || others.some((v) => near(rest, v)))) continue; // engine counted it once: fine
      const { line: priced, dollars } = dollarize(ctx, l, amount);
      const how = extra.fm.member.role === 'duplicate' ? 'a second copy of' : 'an amount already included in';
      out.push(makeResult(ctx, {
        kind: 'error', check: 'double_counted', subject: l.key,
        title: `${shortLabel(l.label)}: ${priced === l ? usd(amount) : `${qty(amount)} ${/mile/i.test(l.label) ? 'miles' : 'units'}`} counted twice`,
        message: `${l.key} (${priced === l ? usd(l.value) : qty(l.value)}) adds ${extra.s} on top of ${counted.s}, but ${extra.s} is ${how} the same item. `
          + `Corrected ${l.key}: ${priced === l ? usd(l.value - amount) : qty(l.value - amount)}${priced !== l ? `; ${priced.key} falls by ${usd(dollars)}` : ''}.`,
        lines: [...new Set([l.key, priced.key])], facts: [extra.fm.fact.id], evidence: [extra.s, counted.s],
        engine: l.value, expected: l.value - amount,
        effect: overstatementEffect(ctx, priced.key, dollars),
      }));
    }
  }
  return out;
}

/** Two lines each carry one copy of the same fact. */
function duplicateAcrossLines(ctx) {
  const out = [];
  for (const f of ctx.matched.facts) {
    const cites = f.members.flatMap((m) => (ctx.citedBy.get(m.obs) ?? []).map((l) => ({ l, m })))
      .filter(({ l, m }) => isNum(l.value) && near(l.value, Number(m.value)) && l.sources.length === 1);
    const original = cites.find((c) => COUNTED.has(c.m.role));
    for (const dup of cites.filter((c) => EXTRA.has(c.m.role) && c.l.key !== original?.l.key)) {
      if (!original) continue;
      out.push(makeResult(ctx, {
        kind: 'error', check: 'duplicate_lines', subject: dup.l.key,
        title: `${shortLabel(dup.l.label)}: same ${usd(dup.l.value)} already on ${original.l.key}`,
        message: `${dup.l.key} (${dup.m.obs}) and ${original.l.key} (${original.m.obs}) report the same item, so ${usd(dup.l.value)} is counted twice.`,
        lines: [dup.l.key, original.l.key], facts: [f.id], evidence: [dup.m.obs, original.m.obs],
        engine: dup.l.value, expected: 0,
        effect: overstatementEffect(ctx, dup.l.key, dup.l.value),
      }));
    }
  }
  return out;
}

/** A line still relies on a value that a corrected document changed. */
function supersededCited(ctx) {
  const out = [];
  for (const l of ctx.lines) {
    const changed = l.sources.map((s) => ({ s, fm: ctx.factOfObs.get(s) }))
      .filter((x) => x.fm?.member.role === 'superseded')
      .map((x) => ({ ...x, now: x.fm.fact.fields[x.fm.member.field] }))
      .filter((x) => JSON.stringify(x.now) !== JSON.stringify(x.fm.member.value));
    if (!changed.length) continue;
    out.push(makeResult(ctx, {
      kind: 'error', check: 'superseded_source', subject: l.key,
      title: `${l.label}: uses values a CORRECTED form changed`,
      message: changed.map((x) => `${x.s} ${x.fm.member.field} ${x.fm.member.value} is now ${x.now} (${x.fm.fact.id})`).join('; ') + '.',
      lines: [l.key], facts: [...new Set(changed.map((x) => x.fm.fact.id))], evidence: changed.map((x) => x.s),
    }));
  }
  return out;
}

/** A sale reported at the broker's blank basis when another document gives the real basis. */
function lotBasisIgnored(ctx) {
  const out = [];
  for (const f of ctx.matched.facts.filter((x) => x.kind === 'lot')) {
    const { proceeds, basis, adjusted_basis: adjusted, term, sold } = f.fields;
    if (!isNum(adjusted) || !isNum(proceeds) || near(adjusted, basis ?? 0)) continue;
    const l = f.members.flatMap((m) => ctx.citedBy.get(m.obs) ?? []).find((x) => x.form === 'F8949');
    if (!l || !near(l.value, proceeds - (basis ?? 0))) continue; // engine already used the adjusted basis
    const change = (proceeds - adjusted) - l.value;
    const category = term === 'long' ? 'ltcg' : 'stcg';
    const basisObs = f.members.find((m) => m.field === 'adjusted_basis').obs;
    out.push(makeResult(ctx, {
      kind: 'error', check: 'lot_basis', subject: l.key,
      title: `${f.fields.description ?? f.name}, lot ${f.name} sold ${shortDate(sold)}: reported at ${usd(basis ?? 0)} basis`,
      message: `${l.key} reports a gain of ${usd(l.value)} using the 1099-B basis of ${usd(basis ?? 0)}. ${basisObs} gives an adjusted basis of ${usd(adjusted)}`
        + ` (the income is already in wages), so the gain is ${usd(proceeds - adjusted)}.`,
      lines: [l.key], facts: [f.id], evidence: [basisObs, ...f.members.filter((m) => m.field === 'basis').map((m) => m.obs)],
      engine: l.value, expected: proceeds - adjusted,
      effect: ctx.effect(category, change, { caSource: ctx.isCaliforniaSource(sold) }),
    }));
  }
  return out;
}

/** A payment the agency applied to another tax year is claimed on this year's return. */
function taxYearDesignation(ctx) {
  const out = [];
  for (const f of ctx.matched.facts.filter((x) => x.kind === 'payment' && x.fields.year && x.fields.year !== String(ctx.taxYear))) {
    const lines = [...new Set(f.members.flatMap((m) => ctx.citedBy.get(m.obs) ?? []))].filter((l) => /ESTIMATED-PAYMENTS/.test(l.rule ?? ''));
    if (!lines.length) continue;
    const ca = f.id.startsWith('payment:california');
    const agency = f.members.find((m) => m.obs.startsWith('agency:'))?.obs;
    out.push(makeResult(ctx, {
      kind: 'error', check: 'payment_tax_year', subject: f.id,
      title: `${usd(f.fields.amount)} ${ca ? 'California' : 'federal'} payment of ${shortDate(f.fields.date)} belongs to tax year ${f.fields.year}`,
      message: `${lines.map((l) => l.key).join(', ')} counts this payment for ${ctx.taxYear}, but the confirmation designates tax year`
        + ` ${f.fields.year}${agency ? ` and the agency holds it there (${agency})` : ''}. Remove it, or ask the agency to transfer it first.`,
      lines: lines.map((l) => l.key), facts: [f.id], evidence: f.members.map((m) => m.obs),
      engine: f.fields.amount, expected: 0,
      effect: { federal: 0, california: 0, [ca ? 'california_payments' : 'federal_payments']: -f.fields.amount, method: 'payments' },
    }));
  }
  return out;
}

/** A foreign amount converted at another year's average rate. */
function fxRateYear(ctx) {
  const out = [];
  const fx = ctx.packet.raw.engine_reference.parameters.fx;
  for (const l of ctx.lines) {
    const ref = l.sources.find((s) => s.startsWith('ref:fx.'));
    if (!ref) continue;
    const [, cur, rate] = ref.split('.'); // ref:fx.SEK.2024_average
    const m = /^(\d{4})_average$/.exec(rate);
    const right = `${ctx.taxYear}_average`;
    if (!m || Number(m[1]) === ctx.taxYear || !fx[cur]?.[right]) continue;
    const foreign = l.sources.map((s) => ctx.obs(s)).find((o) => o && isNum(o.value));
    if (!foreign) continue;
    const expected = Math.round(foreign.value / fx[cur][right]);
    out.push(makeResult(ctx, {
      kind: 'error', check: 'fx_rate_year', subject: l.key,
      title: `${shortLabel(l.label)}: converted at the ${m[1]} exchange rate`,
      message: `${cur} ${qty(foreign.value)} was converted at ${fx[cur][rate]} (${rate.replace('_', ' ')}); the ${ctx.taxYear} average is ${fx[cur][right]}, giving ${usd(expected)} instead of ${usd(l.value)}.`,
      lines: [l.key], evidence: [foreign.id, ref, `ref:fx.${cur}.${right}`],
      engine: l.value, expected,
      effect: overstatementEffect(ctx, l.key, l.value - expected),
    }));
  }
  return out;
}

/** California-source wages must follow where the work was done, not which state payroll withheld for. */
function residencyWageSourcing(ctx) {
  const l = ctx.lines.find((x) => /R-CA-WAGES-SOURCE/.test(x.rule ?? ''));
  if (!l) return [];
  const end = ctx.caPeriod.to;
  const parts = [];
  const unknown = [];
  for (const src of l.sources) {
    const o = ctx.obs(src);
    if (!o || !/state wages/i.test(o.label ?? '')) continue;
    const w2 = ctx.doc(o.doc_id);
    const stub = ctx.packet.documents.filter((d) => d.document_type === 'paystub' && d.issuer === w2.issuer)
      .flatMap((d) => ctx.packet.observations.filter((x) => x.doc_id === d.id && /ca(lifornia)? (taxable )?wages/i.test(`${x.field} ${x.label}`)))[0];
    const page = ctx.packet.index.pages.get(`${o.doc_id}#${o.page}`).printed_content;
    const ended = page.match(/Employment ended (\d{2})\/(\d{2})\/(\d{4})/);
    const endedIso = ended && `${ended[3]}-${ended[1]}-${ended[2]}`;
    if (stub) parts.push({ src, amount: stub.value, via: stub.id, why: `work moved out of California; ${stub.id} gives CA wages to the move` });
    else if (endedIso && endedIso <= end) parts.push({ src, amount: o.value, via: o.id, why: `employment ended ${endedIso}, while a CA resident` });
    else unknown.push(src);
  }
  if (unknown.length || !parts.length) return [];
  const caOnLine = l.sources.map((s) => ctx.obs(s)).filter((o) => o && /state wages/i.test(o.label ?? '')).reduce((s, o) => s + o.value, 0);
  const expectedWages = sum(parts.map((p) => p.amount));
  const change = expectedWages - caOnLine;
  if (near(change, 0)) return [];
  return [makeResult(ctx, {
    kind: 'error', check: 'ca_wage_sourcing', subject: l.key,
    title: 'California wages include pay earned after the move to Texas',
    message: `${l.key} sources all W-2 state wages (${usd(caOnLine)}) to California, but residency ended ${shortDate(end)}. `
      + parts.map((p) => `${p.src}: ${usd(p.amount)} (${p.why})`).join('; ') + `. California-source wages: ${usd(expectedWages)}.`,
    lines: [l.key], evidence: parts.flatMap((p) => [p.src, p.via]),
    engine: caOnLine, expected: expectedWages,
    effect: { federal: 0, california: Math.round(change * ctx.rates.ca_source_income.california_per_dollar), method: 'rates' },
  })];
}

/** A donated vehicle the charity sold: the deduction cannot exceed the gross proceeds on the 1098-C. */
function donatedVehicleLimit(ctx) {
  const out = [];
  for (const d of ctx.packet.documents.filter((x) => x.document_type === '1098-C')) {
    const proceeds = ctx.packet.observations.find((o) => o.doc_id === d.id && /proceeds/i.test(o.label ?? ''));
    if (!proceeds) continue;
    const docObs = new Set(ctx.packet.observations.filter((o) => o.doc_id === d.id).map((o) => o.id));
    for (const l of ctx.lines.filter((x) => x.sources.some((s) => docObs.has(s)) && isNum(x.value) && x.value > proceeds.value)) {
      out.push(makeResult(ctx, {
        kind: 'error', check: 'vehicle_donation_limit', subject: l.key,
        title: 'Donated vehicle deducted above the charity\'s sale price',
        message: `${l.key} deducts ${usd(l.value)}, but ${d.id} shows the charity sold the vehicle for ${usd(proceeds.value)}; the deduction is limited to the gross proceeds.`,
        lines: [l.key], evidence: [proceeds.id, ...l.sources],
        engine: l.value, expected: proceeds.value,
        effect: ctx.effect('itemized', proceeds.value - l.value),
      }));
    }
  }
  return out;
}

/** The buyer deducts a full-year tax bill although the seller paid (and credited) the pre-closing part. */
function sellerTaxCredit(ctx) {
  const out = [];
  for (const d of ctx.packet.documents.filter((x) => x.document_type === 'closing_statement_buyer')) {
    const credit = ctx.packet.observations.find((o) => o.doc_id === d.id && /tax/i.test(`${o.field} ${o.label}`) && isNum(o.value));
    if (!credit || ctx.citedBy.has(credit.id)) continue;
    const activity = ctx.matched.docActivity.get(d.id);
    const l = ctx.lines.find((x) => x.form === 'SchA' && /real estate tax/i.test(x.label)
      && x.sources.some((s) => ctx.matched.docActivity.get(ctx.obs(s)?.doc_id) === activity));
    if (!l) continue;
    const total = ctx.line('SchA.5d');
    const capped = ctx.line('SchA.5e');
    // Federal SALT is capped: only the part of the reduction that lands below the cap matters.
    const federalChange = Math.min(capped.value, total.value - credit.value) - capped.value;
    out.push(makeResult(ctx, {
      kind: 'error', check: 'seller_tax_credit', subject: l.key,
      title: 'Home property tax includes the seller\'s share',
      message: `${l.key} deducts the full ${usd(l.value)} bill, but ${d.id} credited ${usd(credit.value)} from the seller for the days before closing.`
        + ` Deductible: ${usd(l.value - credit.value)}. Total state and local taxes fall to ${usd(total.value - credit.value)}, below the ${usd(capped.value)} cap.`,
      lines: [l.key, 'SchA.5e'], evidence: [credit.id, ...l.sources],
      engine: l.value, expected: l.value - credit.value,
      effect: {
        federal: Math.round(federalChange * ctx.rates.itemized.federal_per_dollar),
        california: Math.round(-credit.value * ctx.rates.itemized.california_per_dollar), // CA itemizes property tax with no cap
        method: 'rates',
      },
    }));
  }
  return out;
}

/** A page the pipeline did not read, on a document still in use, that carries reportable amounts. */
function unreadPages(ctx) {
  const out = [];
  const superseded = new Set(ctx.matched.relations.filter((r) => r.kind === 'supersedes').map((r) => r.of));
  for (const d of ctx.packet.documents.filter((x) => x.extraction_status === 'partial' && !superseded.has(x.id))) {
    const read = new Set(ctx.packet.observations.filter((o) => o.doc_id === d.id).map((o) => o.page));
    for (const p of ctx.packet.pages.filter((x) => x.doc_id === d.id && !read.has(x.page))) {
      const lot = p.printed_content.match(/\b([A-Z]+\d+) ([^;:]*?) acquired (\S+) sold (\S+) proceeds ([\d,.]+) basis ([\d,.]+)[^;]*?(short|long)-term/);
      if (!lot) continue;
      const [proceeds, basis] = [lot[5], lot[6]].map((x) => parseAmounts(x)[0]);
      const gain = Math.round(proceeds - basis);
      const ref = `doc:${d.id}#page${p.page}`;
      const summaryGap = ctx.diagnostics.find((g) => g.code === 'BROKER_SUMMARY_DETAIL_MISMATCH');
      out.push(makeResult(ctx, {
        kind: 'error', check: 'unread_page', subject: ref,
        title: `${d.id} page ${p.page} was never read: sale ${lot[1]} is missing`,
        message: `${ref} reports ${lot[1]} ${lot[2]} (proceeds ${usd(proceeds)}, basis ${usd(basis)}, ${lot[7]}-term) and it is not on the return.`
          + (summaryGap ? ` It explains the engine's summary-vs-detail gap (${summaryGap.code}).` : ''),
        lines: ['SchD.7'], evidence: [ref, ...(summaryGap?.refs ?? [])],
        engine: 0, expected: gain,
        effect: ctx.effect(lot[7] === 'long' ? 'ltcg' : 'stcg', gain, { caSource: ctx.isCaliforniaSource(lot[4]) }),
      }));
    }
  }
  return out;
}

const SHAPES = { ein: /\b\d{2}-\d{7}\b/g, ssn: /\b\d{3}-\d{2}-\d{4}\b/g };
const sameDigits = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** A value read off a page that is not what the page prints (a transposed EIN), whatever the confidence. */
function printedMismatch(ctx) {
  const out = [];
  for (const o of ctx.packet.observations.filter((x) => x.source_kind === 'doc_value' && SHAPES[x.value_type])) {
    const page = ctx.packet.index.pages.get(`${o.doc_id}#${o.page}`).printed_content;
    if (page.includes(o.text_as_read)) continue;
    const printed = [...page.matchAll(SHAPES[o.value_type])].map((m) => m[0]).find((t) => sameDigits(t, o.text_as_read));
    if (!printed) continue;
    out.push(makeResult(ctx, {
      kind: 'error', check: 'misread_value', subject: o.id,
      title: `${o.label} misread on ${o.doc_id}`,
      message: `${o.id} reads ${o.text_as_read} at confidence ${o.confidence}; the page prints ${printed}.`,
      lines: (ctx.citedBy.get(o.id) ?? []).map((l) => l.key), evidence: [o.id, `doc:${o.doc_id}#page${o.page}`],
      engine: o.value, expected: printed,
    }));
  }
  return out;
}

export const ERROR_CHECKS = [
  doubleCountedInLine, duplicateAcrossLines, supersededCited, lotBasisIgnored, taxYearDesignation, fxRateYear,
  residencyWageSourcing, donatedVehicleLimit, sellerTaxCredit, unreadPages, printedMismatch,
];
