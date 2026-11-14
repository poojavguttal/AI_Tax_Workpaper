// Maps a loaded packet to rows for the tables in db/migrations/0001_packet.sql.
// Pure: no database access, so it is tested without Supabase.

export const PACKET_TABLES = [
  'packet_raw', 'documents', 'pages', 'observations', 'engine_versions',
  'engine_lines', 'engine_diagnostics', 'asset_books', 'periods',
];

export const FACT_TABLES = [
  'activities', 'facts', 'fact_observations', 'fact_merges', 'document_relations', 'document_dispositions',
];

export const packetId = (packet) => `${packet.meta.client_id}@${packet.meta.version}`;

/** Rows for db/migrations/0003_checks.sql from runChecks() results. */
export function toCheckRows(packet, run) {
  const packet_id = packetId(packet);
  return {
    check_results: run.results.map((r) => ({
      packet_id, version: run.version, id: r.id, check_name: r.check, kind: r.kind, subject: r.subject, title: r.title,
      message: r.message, blocking: r.blocking, lines: r.lines, facts: r.facts, evidence: r.evidence,
      engine_value: r.engine, expected_value: r.expected, effect: r.effect, recommendation: r.recommendation,
      alternatives: r.alternatives, due: r.due, requires: r.requires,
    })),
  };
}

/** Rows for db/migrations/0002_facts.sql from a matchFacts() result. */
export function toFactRows(packet, matched) {
  const packet_id = packetId(packet);
  return {
    activities: matched.activities.map((a) => ({ packet_id, id: a.id, name: a.name })),
    facts: matched.facts.map((f) => ({
      packet_id, id: f.id, kind: f.kind, activity_id: f.activity, name: f.name ?? null, label: f.label ?? null,
      home_doc_id: f.home?.doc_id ?? null, home_page: f.home?.page ?? null, status: f.status, fields: f.fields,
      conflicts: f.conflicts, superseded_changes: f.supersededChanges, component_checks: f.componentChecks,
    })),
    fact_observations: matched.facts.flatMap((f) => f.members.map((m) => ({
      packet_id, fact_id: f.id, observation_id: m.obs, role: m.role, field: m.field, value: m.value ?? null,
    }))),
    fact_merges: matched.merges.map((m, seq) => ({
      packet_id, seq, into_fact: m.into, from_fact: m.from, role: m.role, rule: m.rule, why: m.why,
    })),
    document_relations: matched.relations.map(({ kind, doc, of, rule, ...detail }, seq) => ({
      packet_id, seq, kind, doc_id: doc, of_doc_id: of, detail: Object.keys(detail).length ? detail : null, rule,
    })),
    document_dispositions: matched.dispositions.map((d) => ({ packet_id, ...d })),
  };
}

export function toRows(packet, { sha256 }) {
  const packet_id = packetId(packet);
  return {
    packet_raw: [{ id: packet_id, json: packet.raw, sha256 }],
    documents: packet.documents.map((d) => ({
      packet_id, id: d.id, title: d.title, document_type: d.document_type, issuer: d.issuer ?? null,
      belongs_to: d.belongs_to, tax_year: d.tax_year ?? null, received_at: d.received_at ?? null,
      uploaded_by: d.uploaded_by ?? null, file_name: d.file_name ?? null, page_count: d.page_count,
      marked_corrected: d.marked_corrected, extraction_status: d.extraction_status, extraction_reason: d.extraction_reason,
    })),
    pages: packet.pages.map((p) => ({ packet_id, ...p })),
    observations: packet.observations.map((o) => {
      const { id, source_kind, label, field, value, value_type, text_as_read, doc_id, page, position, confidence, author, as_of,
        ...extra } = o;
      delete extra.source_ref; // same as id
      return {
        packet_id, id, source_kind, label: label ?? null, field: field ?? null, value: value ?? null,
        value_type: value_type ?? null, text_as_read: text_as_read ?? null, doc_id: doc_id ?? null, page: page ?? null,
        position: position ?? null, confidence: confidence ?? null, author: author ?? null, as_of: as_of ?? null,
        extra: Object.keys(extra).length ? extra : null,
      };
    }),
    engine_versions: packet.versions.map((v) => ({
      packet_id, version: v.version, computed_at: v.computed_at, trigger: v.trigger, documents_used: v.documents_used,
      documents_superseded: v.documents_superseded, summary: v.summary, tax_effect_rates: v.tax_effect_rates,
      carryovers_out: v.carryovers_out, changes_from_previous: v.changes_from_previous,
    })),
    engine_lines: packet.lines.map((l) => ({
      packet_id, version: l.version, key: l.key, ord: l.order, jurisdiction: l.jurisdiction, form: l.form, line: l.line,
      label: l.label ?? null, value: l.value, rule: l.rule ?? null, inputs: l.inputs, sources: l.sources, note: l.note,
    })),
    engine_diagnostics: packet.diagnostics.map((g) => ({
      packet_id, version: g.version, seq: g.seq, code: g.code, severity: g.severity, message: g.message, refs: g.refs,
    })),
    asset_books: packet.assetBooks.map((b) => ({ packet_id, ...b })),
    periods: packet.periods.map((p, seq) => ({
      packet_id, seq, kind: p.kind, state: p.state, status: p.status, date_from: p.from, date_to: p.to,
    })),
  };
}
