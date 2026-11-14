// Groups observations into facts. Every observation starts in its own fact (or in a
// record fact with the other fields of the same lot, trip or payment row), then
// content rules merge facts that describe the same real-world item. The output is
// deterministic; people will later confirm, split or merge through events.

import { routeDocuments, routeStatement } from './activities.js';
import { RULES } from './rules.js';
import { assess } from './status.js';

// Field names like N1_proceeds, C6_basis, trip3_miles, pay5_year, RSU-2502_acquired group
// into one record. Box fields (box12_W, box5_03) stay separate: each box is its own amount.
const RECORD_FIELD = /^([A-Za-z]+-?\d+)_(.+)$/;
const LOT_DOC_TYPES = new Set(['1099-composite', '1099-DA', 'transaction_export', 'stock_plan_supplement']);

function splitField(field) {
  const m = RECORD_FIELD.exec(field);
  if (!m || /^box/i.test(m[1])) return { name: field, part: 'value', isRecord: false };
  return { name: m[1], part: m[2], isRecord: true };
}

export function matchFacts(packet) {
  const { activities, docActivity, issuerWords } = routeDocuments(packet);
  const facts = new Map();
  const relations = [];
  const merges = [];

  const newFact = (id, props) => {
    const fact = { id, members: [], ...props };
    facts.set(id, fact);
    return fact;
  };
  const addMember = (fact, obs, role, field = 'value', value) =>
    fact.members.push({ obs: obs.id, role, field, value: value === undefined ? obs.value : value });

  // 1. Seed: one fact per document field (or record), statement, agency record, prior-year value.
  for (const obs of packet.observations) {
    if (obs.source_kind === 'doc_value') {
      const doc = packet.index.documents.get(obs.doc_id);
      const { name, part, isRecord } = splitField(obs.field);
      const id = `${obs.doc_id}#${obs.page}:${name}`;
      const fact = facts.get(id) ?? newFact(id, {
        kind: isRecord ? (LOT_DOC_TYPES.has(doc.document_type) ? 'lot' : 'record') : 'value',
        name, activity: docActivity.get(obs.doc_id),
        label: isRecord ? `${doc.title} - ${name}` : `${doc.title} - ${obs.label}`,
        home: { doc_id: obs.doc_id, page: obs.page },
      });
      addMember(fact, obs, 'primary', part);
    } else if (obs.source_kind === 'client') {
      const isOrganizer = obs.id.startsWith('household:');
      const fact = newFact(isOrganizer ? `person:${obs.id.slice('household:'.length)}` : `stmt:${obs.id}`, {
        kind: isOrganizer ? 'identity' : 'statement',
        name: obs.id, activity: isOrganizer ? 'household' : routeStatement(obs, { docActivity, issuerWords }), label: obs.label,
      });
      addMember(fact, obs, 'primary');
    } else if (obs.source_kind === 'agency') {
      const area = obs.id.startsWith('agency:/notices') ? 'notices' : obs.id.startsWith('agency:/efile') ? 'filing' : 'payments';
      addMember(newFact(obs.id, { kind: 'agency_record', name: obs.id, activity: area, label: obs.label }), obs, 'primary');
    } else {
      addMember(newFact(obs.id, { kind: 'prior_year', name: obs.id, activity: 'prior_year', label: obs.label }), obs, 'primary');
    }
  }

  // 2. Merge facts that describe the same item. `role` describes how the absorbed
  // observations relate to the surviving fact.
  const ctx = {
    packet, facts, docActivity, relations,
    factsOfDoc: (docId, page) => [...facts.values()].filter((f) => f.home?.doc_id === docId && (page === undefined || f.home.page === page)),
    observation: (id) => packet.index.observations.get(id),
    pageText: (docId, page) => packet.index.pages.get(`${docId}#${page}`)?.printed_content ?? '',
    docText: (docId) => packet.pages.filter((p) => p.doc_id === docId).map((p) => p.printed_content).join(' '),
    newFact, addMember,
    // opts.field renames the absorbed observations' field (e.g. 'ssn' -> 'value');
    // opts.value replaces their value (e.g. an amount parsed from a client's answer).
    absorb(target, source, role, rule, why, opts = {}) {
      if (target === source || !facts.has(source.id)) return;
      for (const m of source.members) {
        target.members.push({
          ...m,
          role: m.role === 'primary' ? role : m.role,
          field: opts.field ?? m.field,
          value: opts.value !== undefined ? opts.value : m.value,
        });
      }
      facts.delete(source.id);
      merges.push({ into: target.id, from: source.id, role, rule, why });
    },
  };
  for (const rule of RULES) rule(ctx);

  // 3. Documents with nothing extracted still need to be accounted for.
  const dispositions = packet.documents
    .filter((d) => d.extraction_status === 'not_extracted' && !packet.observations.some((o) => o.doc_id === d.id))
    .map((d) => ({ doc_id: d.id, kind: 'reproduced_elsewhere', reason: d.extraction_reason, by: 'system' }));

  const out = [...facts.values()]
    .map((f) => ({ ...f, ...assess(f) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { activities: [...activities.values()], facts: out, relations, merges, dispositions, docActivity };
}
