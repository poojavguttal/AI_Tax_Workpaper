// Unresolved conflicts: the evidence disagrees (or is missing) and a person must
// decide which to rely on. Each carries a recommendation, the alternatives and their
// effects; none closes until a decision is recorded and signed off.

import { makeResult, usd, shortDate } from './result.js';
import { parseAmounts, parseDates, daysBetween } from '../facts/text.js';

// Independent records outweigh a client's recollection.
const WEIGHT = { agency: 3, doc_value: 2, prior_year: 2, client: 1 };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Facts whose observations disagree (Theo's SSN, the federal Q4 estimate). */
function factConflicts(ctx) {
  const out = [];
  for (const f of ctx.matched.facts.filter((x) => x.status === 'conflict')) {
    for (const c of f.conflicts) {
      const support = new Map();
      for (const v of c.values) {
        const key = JSON.stringify(v.value);
        const s = support.get(key) ?? { value: v.value, weight: 0, obs: [] };
        s.weight += WEIGHT[ctx.obs(v.obs)?.source_kind] ?? 1;
        s.obs.push(v.obs);
        support.set(key, s);
      }
      const ranked = [...support.values()].sort((a, b) => b.weight - a.weight);
      const [best, ...rest] = ranked;
      // What did the engine use? A line citing an observation that holds a minority value.
      const used = c.values.map((v) => ({ v, lines: ctx.citedBy.get(v.obs) ?? [] })).find((x) => x.lines.length);
      const engineValue = used?.v.value;
      const isPayment = f.kind === 'payment';
      const jurisdiction = f.id.split(':')[1];
      const change = isPayment && isNum(engineValue) ? best.value - engineValue : 0;
      const describe = (s) => `${typeof s.value === 'number' ? usd(s.value) : s.value} (${s.obs.join(', ')})`;
      out.push(makeResult(ctx, {
        kind: 'conflict', check: 'fact_conflict', subject: `${f.id}.${c.field}`,
        title: f.kind === 'identity'
          ? `${f.label.replace(/: (\w+)$/, (_, a) => `'s ${a.toUpperCase()}`)} differs across sources`
          : `${f.label.replace(/\d{4}-\d{2}-\d{2}/, (d) => shortDate(d))}: the client and the agency disagree`,
        message: `${describe(best)} vs ${rest.map(describe).join(' vs ')}.`
          + (used ? ` The engine used ${typeof engineValue === 'number' ? usd(engineValue) : engineValue} (${used.lines.map((l) => l.key).join(', ')}).` : '')
          + (f.kind === 'identity' ? ' A wrong identity number rejects the e-file.' : ''),
        lines: used ? used.lines.map((l) => l.key) : [], facts: [f.id], evidence: c.values.map((v) => v.obs),
        engine: engineValue ?? null, expected: best.value,
        effect: change ? { federal: 0, california: 0, [`${jurisdiction}_payments`]: change, method: 'payments' } : undefined,
        recommendation: {
          alternative: 0,
          value: best.value,
          rationale: `Supported by ${best.obs.length} source(s) (${best.obs.map((o) => ctx.obs(o)?.source_kind).join(', ')}); `
            + `the other value rests on ${rest.flatMap((s) => s.obs.map((o) => ctx.obs(o)?.source_kind)).join(', ')}.`,
        },
        alternatives: ranked.map((s) => ({ treatment: `Use ${typeof s.value === 'number' ? usd(s.value) : s.value}`, sources: s.obs,
          effect: isPayment && isNum(engineValue) ? { [`${jurisdiction}_payments`]: s.value - engineValue } : undefined })),
      }));
    }
  }
  return out;
}

/** A lot with no cost basis on any document; the client may have told us what it cost. */
function missingBasis(ctx) {
  const out = [];
  for (const f of ctx.matched.facts.filter((x) => x.kind === 'lot' && x.status === 'incomplete' && x.incomplete.includes('basis'))) {
    const line = f.members.flatMap((m) => ctx.citedBy.get(m.obs) ?? []).find((l) => l.form === 'F8949');
    const { proceeds, sold } = f.fields;
    const offers = ctx.matched.facts.filter((s) => s.kind === 'statement' && s.activity === f.activity).flatMap((s) => {
      const o = ctx.obs(s.members[0].obs);
      const [amount] = parseAmounts(o.value);
      const [acquired] = parseDates(o.value).filter((d) => d < sold);
      return amount && acquired ? [{ obs: o.id, amount, acquired }] : [];
    });
    const engineGain = line?.value ?? proceeds;
    const alternatives = [{ treatment: 'Zero basis, short-term (as computed)', effect: { federal: 0, california: 0 } }];
    let recommendation = { alternative: null, treatment: 'Ask the client for purchase records', rationale: 'No document gives a cost basis.' };
    let effect;
    for (const offer of offers) {
      const longTerm = daysBetween(offer.acquired, sold) > 365;
      const gain = proceeds - offer.amount;
      const fed = Math.round(-engineGain * ctx.rates.stcg.federal_per_dollar + gain * ctx.rates[longTerm ? 'ltcg' : 'stcg'].federal_per_dollar);
      const ca = Math.round((gain - engineGain) * (ctx.isCaliforniaSource(sold) ? ctx.rates.ca_source_income : ctx.rates.stcg).california_per_dollar);
      effect = { federal: fed, california: ca, method: 'rates' };
      alternatives.push({ treatment: `Basis ${offer.amount}, acquired ${offer.acquired} (${longTerm ? 'long' : 'short'}-term), per ${offer.obs}`, effect });
      recommendation = {
        alternative: alternatives.length - 1,
        treatment: `Use basis ${offer.amount} and holding period from ${offer.acquired}, if the client's bank record is attached`,
        rationale: `${offer.obs} gives the purchase price and date; a bank statement substantiates it. Without it, zero basis stands.`,
      };
    }
    out.push(makeResult(ctx, {
      kind: 'conflict', check: 'missing_basis', subject: f.id,
      title: `${f.fields.asset ?? f.name} sold ${shortDate(sold)}: no cost basis on any document`,
      message: `${line?.key ?? 'The lot'} reports ${usd(engineGain)} of short-term gain at zero basis.`
        + (offers.length ? ` The client says otherwise: ${offers.map((x) => `${x.obs} (${usd(x.amount)}, bought ${shortDate(x.acquired)})`).join('; ')}.` : ''),
      lines: line ? [line.key] : [], facts: [f.id], evidence: [...f.members.map((m) => m.obs), ...offers.map((x) => x.obs)],
      engine: 0, expected: offers[0]?.amount ?? null, effect, recommendation, alternatives,
    }));
  }
  return out;
}

/** A low-confidence or ambiguous read that a return line relies on. */
function uncertainReads(ctx) {
  const out = [];
  for (const o of ctx.packet.observations.filter((x) => x.source_kind === 'doc_value' && isNum(x.value))) {
    const page = ctx.packet.index.pages.get(`${o.doc_id}#${o.page}`).printed_content;
    const ambiguous = /\$?\?[\d,]/.test(page);
    if (o.confidence >= 0.6 && !ambiguous) continue;
    const lines = ctx.citedBy.get(o.id) ?? [];
    const fact = ctx.factOfObs.get(o.id).fact;
    const support = ctx.matched.facts.filter((s) => s.kind === 'statement' && s.activity === fact.activity)
      .map((s) => ctx.obs(s.members[0].obs)).filter((s) => parseAmounts(s.value).includes(o.value));
    const readings = ambiguous ? [...page.matchAll(/could be read as (\d) or (\d)/g)].flatMap((m) => [m[1], m[2]]) : [];
    const alt = readings.map((digit) => Number(o.text_as_read.replace(/^\D*\d/, digit).replace(/[^\d.]/g, ''))).filter((v) => v !== o.value);
    out.push(makeResult(ctx, {
      kind: 'conflict', check: 'uncertain_read', subject: o.id,
      title: `${o.label} on ${o.doc_id} is uncertain`,
      message: `${o.id} reads ${o.text_as_read} at confidence ${o.confidence}${ambiguous ? '; the page itself is ambiguous' : ''}.`
        + (support.length ? ` ${support.map((s) => s.id).join(', ')} states ${o.value}.` : ''),
      lines: lines.map((l) => l.key), facts: [fact.id], evidence: [o.id, `doc:${o.doc_id}#page${o.page}`, ...support.map((s) => s.id)],
      engine: o.value, expected: o.value,
      recommendation: {
        alternative: 0,
        value: o.value,
        rationale: support.length
          ? `The client confirms ${o.value}; attach the bank record as substantiation for a gift of 250 or more.`
          : 'Confirm the amount with the client and attach substantiation.',
      },
      alternatives: [o.value, ...alt].map((v) => ({
        treatment: `Use ${v}`,
        effect: v === o.value ? { federal: 0, california: 0 } : ctx.effect('itemized', v - o.value),
      })),
    }));
  }
  return out;
}

// Questionnaire answers that the documents contradict. Each entry is a rule in the
// library: which question, what answer, and what evidence contradicts it.
const ASSERTIONS = [
  {
    id: 'no_investment_sales',
    question: /sell any stocks|investments/i,
    answer: /^no\b/i,
    contradiction: (ctx) => {
      const lots = ctx.matched.facts.filter((f) => f.kind === 'lot' && ctx.packet.index.documents.get(f.home.doc_id).document_type !== 'stock_plan_supplement');
      return lots.length ? { evidence: [...new Set(lots.map((f) => f.home.doc_id))], detail: `${lots.length} sales on broker and exchange forms` } : null;
    },
    recommendation: 'The broker forms govern; confirm with the client that every account is in the file.',
  },
  {
    id: 'no_prior_ira_basis',
    question: /ira details|prior basis/i,
    answer: /prior basis: none|no prior basis/i,
    contradiction: (ctx) => {
      const f = ctx.factById.get('py:/return_2024/lines/F8606.14');
      const value = f?.fields.value;
      return value > 0 ? { evidence: [f.id, ...f.members.map((m) => m.obs)], detail: `the 2024 Form 8606 carries basis of ${value}`, value } : null;
    },
    recommendation: 'Keep the 2024 Form 8606 basis; the 2024 Form 5498 confirms the contribution.',
    alternativeEffect: (ctx, c) => ctx.effect('ordinary_income', c.value),
  },
];

function questionnaireContradictions(ctx) {
  const out = [];
  for (const q of ctx.packet.raw.client.questionnaire) {
    for (const a of ASSERTIONS) {
      if (!a.question.test(q.question) || !a.answer.test(q.answer)) continue;
      const c = a.contradiction(ctx);
      if (!c) continue;
      const usedBy = c.evidence.flatMap((e) => ctx.citedBy.get(e) ?? []).map((l) => l.key);
      out.push(makeResult(ctx, {
        kind: 'conflict', check: 'questionnaire_contradiction', subject: `${q.id}:${a.id}`,
        title: `Client answer contradicted: "${q.question}"`,
        message: `${q.id} answers "${q.answer}", but ${c.detail}.${usedBy.length ? ` The engine follows the documents (${usedBy.join(', ')}).` : ''}`,
        lines: usedBy, evidence: [q.id, ...c.evidence],
        recommendation: { alternative: 0, treatment: 'Rely on the documents', rationale: a.recommendation },
        alternatives: [
          { treatment: 'Rely on the documents (as computed)', effect: { federal: 0, california: 0 } },
          { treatment: 'Rely on the client\'s answer', effect: a.alternativeEffect ? a.alternativeEffect(ctx, c) : undefined },
        ],
      }));
    }
  }
  return out;
}

export const CONFLICT_CHECKS = [factConflicts, missingBasis, uncertainReads, questionnaireContradictions];
