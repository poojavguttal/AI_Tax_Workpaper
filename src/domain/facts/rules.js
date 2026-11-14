// Content rules that merge facts describing the same real-world item. Each rule
// reads document types, issuers, page text and values, never specific document ids,
// and records why it merged (shown to the reviewer, and reversible later).

import { parseAmounts, parseDates, daysBetween, keyword, accountSuffixes } from './text.js';
import { sameValue } from './status.js';

const groupBy = (xs, key) => xs.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]), new Map());
const suffixOf = (factId) => factId.slice(factId.indexOf('#'));
const primaryObs = (ctx, fact) => ctx.observation(fact.members.find((m) => m.role === 'primary')?.obs);
const fieldValue = (fact, field) => fact.members.find((m) => m.field === field && m.value !== null)?.value;
// The amount of a single-figure fact, whatever its field is called (e.g. inst2_2425 groups as a record).
const amountOf = (fact) => Number(fact.members.find((m) => m.role === 'primary')?.value);
const isMoney = (ctx, fact) => primaryObs(ctx, fact)?.value_type === 'money';
const docsOfType = (ctx, ...types) => ctx.packet.documents.filter((d) => types.includes(d.document_type));
const byReceived = (a, b) => (a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.id < b.id ? -1 : 1);

function docSignature(ctx, docId) {
  const sig = new Map();
  for (const o of ctx.packet.observations) if (o.doc_id === docId) sig.set(`${o.page}:${o.field}`, o.value);
  return sig;
}

/** Same issuer, type, year and owner; one is a re-upload of the other (e.g. a phone photo of a W-2). */
function duplicateDocuments(ctx) {
  const groups = groupBy(ctx.packet.documents, (d) => [d.document_type, d.issuer, d.tax_year, d.belongs_to].join('|'));
  for (const docs of groups.values()) {
    const sorted = [...docs].sort(byReceived);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [a, b] = [sorted[i], sorted[j]];
        if (a.marked_corrected || b.marked_corrected) continue;
        const sa = docSignature(ctx, a.id);
        const sb = docSignature(ctx, b.id);
        const shared = [...sb].filter(([k, v]) => sa.has(k) && sameValue(sa.get(k), v)).length;
        const overlap = shared / Math.min(sa.size, sb.size);
        if (Math.min(sa.size, sb.size) < 3 || overlap < 0.9) continue;
        ctx.relations.push({ kind: 'duplicate_document', doc: b.id, of: a.id, overlap, rule: 'duplicateDocuments' });
        for (const f of ctx.factsOfDoc(b.id)) {
          const target = ctx.facts.get(`${a.id}${suffixOf(f.id)}`);
          if (target) ctx.absorb(target, f, 'duplicate', 'duplicateDocuments', `${b.id} repeats ${a.id} (${Math.round(overlap * 100)}% of fields identical)`);
        }
      }
    }
  }
}

/** A form the issuer marked CORRECTED replaces the earlier one, field by field. */
function supersession(ctx) {
  const groups = groupBy(ctx.packet.documents, (d) => [d.document_type, d.issuer, d.tax_year, d.belongs_to].join('|'));
  for (const docs of groups.values()) {
    const corrected = docs.filter((d) => d.marked_corrected).sort(byReceived);
    const originals = docs.filter((d) => !d.marked_corrected);
    for (const c of corrected) {
      for (const o of originals.filter((x) => x.received_at < c.received_at)) {
        const changed = [];
        for (const f of ctx.factsOfDoc(o.id)) {
          const target = ctx.facts.get(`${c.id}${suffixOf(f.id)}`);
          if (!target) continue;
          for (const m of f.members) {
            const now = target.members.find((t) => t.field === m.field && t.role === 'primary');
            if (now && !sameValue(now.value, m.value)) changed.push({ fact: target.id, field: m.field, from: m.value, to: now.value });
          }
          ctx.absorb(target, f, 'superseded', 'supersession', `${c.id} (CORRECTED) replaces ${o.id}`);
        }
        ctx.relations.push({ kind: 'supersedes', doc: c.id, of: o.id, changed, rule: 'supersession' });
      }
    }
  }
}

/** A page scanned twice inside one document (identical extracted values). */
function duplicatePages(ctx) {
  for (const d of ctx.packet.documents) {
    const pages = groupBy(ctx.packet.observations.filter((o) => o.doc_id === d.id), (o) => o.page);
    const sigs = [...pages].map(([page, obs]) => [page, obs.map((o) => `${o.field}=${o.value}`).sort().join('|')]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        if (sigs[i][1] !== sigs[j][1]) continue;
        const [p, q] = [sigs[i][0], sigs[j][0]];
        if (ctx.relations.some((r) => r.kind === 'duplicate_page' && r.doc === d.id && r.page === q)) continue;
        ctx.relations.push({ kind: 'duplicate_page', doc: d.id, page: q, of_page: p, rule: 'duplicatePages' });
        for (const f of ctx.factsOfDoc(d.id, q)) {
          const target = ctx.facts.get(`${d.id}#${p}:${f.name}`);
          if (target) ctx.absorb(target, f, 'duplicate', 'duplicatePages', `${d.id} page ${q} is a second scan of page ${p}`);
        }
      }
    }
  }
}

/** The same account's interest reported on a composite 1099 and again on a standalone 1099-INT. */
function sameAccountInterest(ctx) {
  const docs = docsOfType(ctx, '1099-INT', '1099-composite');
  const candidates = [];
  for (const d of docs) {
    const accounts = accountSuffixes(`${d.title} ${ctx.docText(d.id)}`);
    for (const f of ctx.factsOfDoc(d.id)) {
      if (f.kind === 'value' && isMoney(ctx, f) && /interest/i.test(primaryObs(ctx, f).label) && Number(fieldValue(f, 'value')) > 0) {
        for (const a of accounts) candidates.push({ account: a, doc: d, fact: f });
      }
    }
  }
  for (const group of groupBy(candidates, (c) => c.account).values()) {
    const sorted = [...group].sort((x, y) => (x.doc.id < y.doc.id ? -1 : 1));
    for (const c of sorted.slice(1)) {
      if (c.doc.id === sorted[0].doc.id || !sameValue(fieldValue(c.fact, 'value'), fieldValue(sorted[0].fact, 'value'))) continue;
      ctx.relations.push({ kind: 'same_fact', doc: c.doc.id, of: sorted[0].doc.id, account: c.account, rule: 'sameAccountInterest' });
      ctx.absorb(sorted[0].fact, c.fact, 'duplicate', 'sameAccountInterest',
        `Both report interest on account ending ${c.account}`);
    }
  }
}

/** Property tax paid from a lender's escrow appears on the 1098 (box 10) and on the tax bill or receipt. */
function escrowTaxes(ctx) {
  for (const d1098 of docsOfType(ctx, '1098')) {
    const target = ctx.factsOfDoc(d1098.id).find((f) => /real estate tax/i.test(primaryObs(ctx, f)?.label ?? '') && Number(fieldValue(f, 'value')) > 0);
    if (!target) continue;
    const total = Number(fieldValue(target, 'value'));
    for (const t of docsOfType(ctx, 'property_tax_bill', 'property_tax_receipt')) {
      const text = ctx.docText(t.id).toLowerCase();
      const sameProperty = ctx.docActivity.get(t.id) === ctx.docActivity.get(d1098.id);
      if (!text.includes('escrow') || !(text.includes(keyword(d1098.issuer)) || sameProperty)) continue;
      const amounts = ctx.factsOfDoc(t.id).filter((f) => isMoney(ctx, f) && f.members.length === 1);
      const exact = amounts.find((f) => sameValue(amountOf(f), total));
      if (exact) {
        ctx.relations.push({ kind: 'same_fact', doc: t.id, of: d1098.id, rule: 'escrowTaxes' });
        ctx.absorb(target, exact, 'duplicate', 'escrowTaxes', `${t.id} is the bill the lender paid from escrow; same payment as ${d1098.id} box 10`);
      } else if (amounts.length > 1 && sameValue(amounts.reduce((s, f) => s + amountOf(f), 0), total)) {
        ctx.relations.push({ kind: 'components', doc: t.id, of: d1098.id, rule: 'escrowTaxes' });
        for (const f of amounts) {
          ctx.absorb(target, f, 'component', 'escrowTaxes', `${t.id} installments paid from escrow make up ${d1098.id} box 10`, { field: 'value' });
        }
      }
    }
  }
}

/** Interest on a payoff statement that the lender says is already in its 1098 box 1. */
function payoffInterest(ctx) {
  for (const payoff of docsOfType(ctx, 'payoff_statement')) {
    const interest = ctx.factsOfDoc(payoff.id).find((f) => /interest/i.test(primaryObs(ctx, f)?.label ?? ''));
    const lender1098 = docsOfType(ctx, '1098').find((d) => d.issuer === payoff.issuer && /payoff/i.test(ctx.docText(d.id)));
    const box1 = lender1098 && ctx.factsOfDoc(lender1098.id).find((f) => /mortgage interest/i.test(primaryObs(ctx, f)?.label ?? ''));
    if (!interest || !box1) continue;
    ctx.relations.push({ kind: 'included_in', doc: payoff.id, of: lender1098.id, rule: 'payoffInterest' });
    ctx.absorb(box1, interest, 'included_in', 'payoffInterest', `${lender1098.id} box 1 says it includes interest paid at payoff`);
  }
}

/** Card receipts on a 1099-K that the books say are part of a payer's 1099-NEC total. */
function processorIncluded(ctx) {
  const books = ctx.packet.documents.filter((d) => d.document_type.startsWith('books_'));
  for (const k of docsOfType(ctx, '1099-K')) {
    const gross = ctx.factsOfDoc(k.id).find((f) => /gross/i.test(primaryObs(ctx, f)?.label ?? ''));
    if (!gross) continue;
    for (const nec of docsOfType(ctx, '1099-NEC')) {
      const box1 = ctx.factsOfDoc(nec.id).find((f) => /nonemployee compensation/i.test(primaryObs(ctx, f)?.label ?? ''));
      if (!box1) continue;
      for (const b of books) {
        for (const page of new Set(ctx.packet.pages.filter((p) => p.doc_id === b.id).map((p) => p.page))) {
          const text = ctx.pageText(b.id, page).toLowerCase();
          if (!text.includes(keyword(k.issuer)) || !text.includes(keyword(nec.issuer))) continue;
          const onPage = ctx.factsOfDoc(b.id, page).filter((f) => isMoney(ctx, f));
          const part = onPage.find((f) => sameValue(fieldValue(f, 'value'), fieldValue(gross, 'value')));
          const whole = onPage.find((f) => sameValue(fieldValue(f, 'value'), fieldValue(box1, 'value')));
          if (!part || !whole) continue;
          ctx.relations.push({ kind: 'included_in', doc: k.id, of: nec.id, evidence: `${b.id}#${page}`, rule: 'processorIncluded' });
          ctx.absorb(box1, gross, 'included_in', 'processorIncluded', `${b.id} p${page}: ${nec.issuer} paid part of its total through ${k.issuer}`);
          ctx.absorb(box1, part, 'included_in', 'processorIncluded', `${b.id} p${page} shows the card-processed part`);
          ctx.absorb(box1, whole, 'supporting', 'processorIncluded', `${b.id} p${page} shows the payer's total`);
        }
      }
    }
  }
}

/** One sale described across documents: broker form + cost-basis export, or broker form + stock plan supplement. */
function lotParts(ctx) {
  const lots = () => [...ctx.facts.values()].filter((f) => f.kind === 'lot');
  // Same issuer, same lot id, different documents (1099-DA proceeds + export with cost basis).
  for (const group of groupBy(lots(), (f) => `${ctx.packet.index.documents.get(f.home.doc_id).issuer}|${f.name}`).values()) {
    const [first, ...rest] = [...group].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const f of rest) {
      if (f.home.doc_id === first.home.doc_id) continue;
      ctx.absorb(first, f, 'part', 'lotParts', `Same ${first.name} lot from the same broker`);
    }
  }
  // A stock plan supplement record matches a broker lot by acquisition date and company.
  for (const sup of lots().filter((f) => ctx.packet.index.documents.get(f.home.doc_id).document_type === 'stock_plan_supplement')) {
    const company = keyword(ctx.packet.index.documents.get(sup.home.doc_id).issuer);
    const acquired = fieldValue(sup, 'acquired');
    const match = lots().find((l) => l !== sup && fieldValue(l, 'acquired') === acquired
      && String(fieldValue(l, 'description') ?? '').toLowerCase().includes(company));
    if (match) ctx.absorb(match, sup, 'part', 'lotParts', `${sup.name} on the plan supplement is lot ${match.name} (acquired ${acquired})`);
  }
}

/** A 2024 return line and the values read off the 2024 return document are one fact. */
function priorYearLines(ctx) {
  for (const f of [...ctx.facts.values()].filter((x) => x.id.startsWith('py:/return_2024/lines/'))) {
    for (const ev of ctx.observation(f.id).supporting_refs ?? []) {
      const holder = [...ctx.facts.values()].find((x) => x.members.some((m) => m.obs === ev));
      if (holder) ctx.absorb(f, holder, 'duplicate', 'priorYearLines', `Read from the 2024 return (${ev})`, { field: 'value' });
    }
  }
}

/** A person's SSN, birth date and IP PIN as entered by the client, filed last year and printed on documents. */
function identity(ctx) {
  const people = ctx.packet.people;
  const ownerOf = (belongsTo) => belongsTo === 'taxpayer' ? people.find((p) => p.role === 'taxpayer')
    : belongsTo === 'spouse' ? people.find((p) => p.role === 'spouse')
      : belongsTo?.startsWith('dependent:') ? people.find((p) => p.id === belongsTo.slice('dependent:'.length)) : null;
  const attach = (person, attr, fact, why) => {
    const target = ctx.facts.get(`person:${person.id}.${attr}`);
    if (target) ctx.absorb(target, fact, 'supporting', 'identity', why, { field: 'value' });
  };

  const priorDependents = ctx.packet.raw.prior_years.return_2024.dependents;
  priorDependents.forEach((dep, i) => {
    const person = people.find((p) => p.name === dep.name);
    if (!person) return;
    const py = ctx.facts.get(`py:/return_2024/dependents/${i}/ssn`);
    if (py) attach(person, 'ssn', py, 'SSN on the 2024 return as filed');
    const onDoc = [...ctx.facts.values()].find((f) => f.home && ctx.packet.index.documents.get(f.home.doc_id).document_type === 'prior_year_return'
      && f.name === `dep${i + 1}`);
    if (onDoc) attach(person, 'ssn', onDoc, 'SSN printed on the 2024 return');
  });

  for (const f of [...ctx.facts.values()].filter((x) => x.home && x.kind === 'value')) {
    const o = primaryObs(ctx, f);
    const doc = ctx.packet.index.documents.get(f.home.doc_id);
    const person = ownerOf(doc.belongs_to);
    if (!person) continue;
    const attr = o.value_type === 'ssn' ? 'ssn' : o.field === 'dob' ? 'dob' : o.field === 'ip_pin' ? 'ip_pin' : null;
    if (attr) attach(person, attr, f, `${attr.toUpperCase()} printed on ${doc.id} (${doc.title})`);
  }
}

/** Estimated payments: agency records, payment confirmations and the client's own account, by date. */
function payments(ctx) {
  const jurisdictionOf = (issuer) => (/franchise tax board|ftb/i.test(issuer) ? 'california' : 'federal');
  const paymentFact = (jurisdiction, date, label) => ctx.facts.get(`payment:${jurisdiction}:${date}`)
    ?? ctx.newFact(`payment:${jurisdiction}:${date}`, { kind: 'payment', name: `${jurisdiction} ${date}`, activity: 'payments', label, members: [] });

  for (const f of [...ctx.facts.values()].filter((x) => x.kind === 'agency_record')) {
    const rec = ctx.observation(f.id).record;
    const isIrsPayment = f.id.startsWith('agency:/irs_account_transcript_2025') && rec.code === '670';
    const isFtbPayment = f.id.startsWith('agency:/ftb_account');
    if (!isIrsPayment && !isFtbPayment) continue;
    const j = isIrsPayment ? 'federal' : 'california';
    const target = paymentFact(j, rec.date, `${j === 'federal' ? 'Federal' : 'California'} payment ${rec.date}`);
    const role = target.members.length ? 'duplicate' : 'primary';
    ctx.absorb(target, f, role, 'payments', role === 'duplicate' ? 'Same transaction in a later transcript snapshot' : 'Agency record', { field: 'amount' });
  }

  for (const d of docsOfType(ctx, 'payment_confirmation')) {
    const j = jurisdictionOf(d.issuer);
    for (const f of ctx.factsOfDoc(d.id).filter((x) => x.kind === 'record')) {
      const date = fieldValue(f, 'date');
      if (!date) continue;
      const existing = ctx.facts.get(`payment:${j}:${date}`);
      const target = existing ?? paymentFact(j, date, `${j === 'federal' ? 'Federal' : 'California'} payment ${date}`);
      ctx.absorb(target, f, existing ? 'supporting' : 'primary', 'payments', existing ? `Client's ${d.id} confirmation of the same payment` : `${d.id} confirmation`);
    }
  }

  // Client answers that state a payment ("Paid January 14, 2026 - 4,000 I think").
  for (const f of [...ctx.facts.values()].filter((x) => x.kind === 'statement' && x.id.startsWith('stmt:qa-'))) {
    const o = ctx.observation(f.members[0].obs);
    if (!/estimated (tax )?payment/i.test(o.label)) continue;
    const [date] = parseDates(o.value);
    const [amount] = parseAmounts(o.value);
    if (!date || amount === undefined) continue;
    const j = /california|ftb/i.test(o.label) ? 'california' : 'federal';
    const near = [...ctx.facts.values()].filter((x) => x.kind === 'payment' && x.id.startsWith(`payment:${j}:`))
      .map((x) => [x, daysBetween(x.id.split(':')[2], date)]).filter(([, dd]) => dd <= 7).sort((a, b) => a[1] - b[1])[0];
    if (near) ctx.absorb(near[0], f, 'supporting', 'payments', `Client says ${amount} on ${date}`, { field: 'amount', value: amount });
  }
}

export const RULES = [
  duplicateDocuments,
  supersession,
  duplicatePages,
  sameAccountInterest,
  escrowTaxes,
  payoffInterest,
  processorIncluded,
  lotParts,
  priorYearLines,
  identity,
  payments,
];
