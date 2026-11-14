// Turns every source record in the packet into an observation: one source's
// statement of a value, with a reference back to where it came from.
// Observations are evidence only; facts and resolutions are built on top later.

import { toPointer } from './pointer.js';

const isLeaf = (v) => v === null || typeof v !== 'object';

function* walkLeaves(node, path = []) {
  if (isLeaf(node)) {
    yield [path, node];
    return;
  }
  const entries = Array.isArray(node) ? node.map((v, i) => [i, v]) : Object.entries(node);
  for (const [k, v] of entries) yield* walkLeaves(v, [...path, k]);
}

const docObservation = (ev, doc) => ({
  id: ev.id,
  source_kind: 'doc_value',
  source_ref: ev.id,
  label: ev.label,
  field: ev.field,
  value: ev.value,
  value_type: ev.value_type,
  text_as_read: ev.text_as_read,
  doc_id: ev.document_id,
  page: ev.page,
  position: ev.position,
  confidence: ev.confidence,
  as_of: doc?.received_at ?? null,
});

function clientObservations(raw) {
  const out = [];
  for (const q of raw.client.questionnaire) {
    out.push({ id: q.id, source_kind: 'client', source_ref: q.id, label: q.question, value: q.answer,
      value_type: 'text', author: q.answered_by, as_of: q.answered_at });
  }
  for (const m of raw.client.messages) {
    out.push({ id: m.id, source_kind: 'client', source_ref: m.id, label: `Message from ${m.from}`, value: m.text,
      value_type: 'text', author: m.from, as_of: m.sent_at });
  }
  for (const c of raw.client.call_notes) {
    out.push({ id: c.id, source_kind: 'client', source_ref: c.id, label: `Call notes (${c.participants.join(', ')})`,
      value: c.notes, value_type: 'text_list', author: c.participants.join(', '), as_of: c.date });
  }
  // Organizer entries are the client's own statements (e.g. a dependent's SSN), so they
  // are observations too. Ref format extends the README's household:<id> with .<field>.
  const organizerDate = raw.household.entered_by?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  for (const person of raw.household.people) {
    for (const [field, value] of Object.entries(person)) {
      if (field === 'id' || value === null || typeof value === 'object') continue;
      const ref = `household:${person.id}.${field}`;
      out.push({ id: ref, source_kind: 'client', source_ref: ref, label: `${person.name}: ${field}`, value,
        value_type: field === 'ssn' ? 'ssn' : 'text', author: 'organizer', as_of: organizerDate, person_id: person.id });
    }
  }
  return out;
}

function agencyObservations(raw) {
  const a = raw.tax_agency_records;
  const out = [];
  const push = (segments, record, value, label, as_of) => {
    const ref = `agency:${toPointer(segments)}`;
    out.push({ id: ref, source_kind: 'agency', source_ref: ref, label, value, value_type: typeof value === 'number' ? 'money' : 'text',
      as_of, record });
  };
  a.irs_account_transcript_2025.forEach((snap, i) => {
    snap.transactions.forEach((t, j) => push(['irs_account_transcript_2025', i, 'transactions', j], t, t.amount,
      `IRS transcript (as of ${snap.as_of}) TC ${t.code}: ${t.description} ${t.date}`, snap.as_of));
  });
  for (const key of Object.keys(a.ftb_account)) {
    if (!Array.isArray(a.ftb_account[key])) continue;
    a.ftb_account[key].forEach((p, i) => push(['ftb_account', key, i], p, p.amount,
      `FTB ${key.replace(/_/g, ' ')}: ${p.date}`, a.ftb_account.as_of));
  }
  a.notices.forEach((n, i) => push(['notices', i], n, n.summary ?? n.type, `${n.agency} ${n.type} (${n.tax_year})`, n.dated));
  a.efile.forEach((e, i) => push(['efile', i], e, e.status, `E-file ${e.jurisdiction} ${e.submission_id}`, e.date));
  return out;
}

function priorYearObservations(raw) {
  const py = raw.prior_years;
  const filed = py.return_2024?.filed ?? null;
  const labels = py.return_2024?.line_labels ?? {};
  const out = [];
  for (const [path, value] of walkLeaves(py)) {
    // line_labels / line_sources describe lines; they are not values in their own right.
    if (path[0] === 'return_2024' && (path[1] === 'line_labels' || path[1] === 'line_sources')) continue;
    const ref = `py:${toPointer(path)}`;
    const lineKey = path[0] === 'return_2024' && path[1] === 'lines' ? path[2] : null;
    out.push({
      id: ref, source_kind: 'prior_year', source_ref: ref,
      label: lineKey ? labels[lineKey] ?? lineKey : path.join(' / '),
      value, value_type: typeof value === 'number' ? 'money' : 'text',
      as_of: filed,
      // line_sources maps each line to one ev id (a string); keep it as a list for uniformity.
      supporting_refs: lineKey ? [py.return_2024.line_sources?.[lineKey]].flat().filter(Boolean) : [],
    });
  }
  return out;
}

/** All observations in the packet, in a stable order. Ids are the packet's own references. */
export function buildObservations(raw, documentsById) {
  return [
    ...raw.extracted_values.map((ev) => docObservation(ev, documentsById.get(ev.document_id))),
    ...clientObservations(raw),
    ...agencyObservations(raw),
    ...priorYearObservations(raw),
  ];
}
