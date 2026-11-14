// Loads the packet exactly as delivered and projects it into the typed records the
// workpaper reads: documents, pages, observations, engine lines, diagnostics,
// asset books and residency periods. The raw packet is frozen and never edited.

import { deepFreeze } from './freeze.js';
import { buildObservations } from './observations.js';

const JURISDICTION_BOOKS = { federal: 'federal', california: 'california', amt: 'amt' };

function projectDocuments(raw) {
  const documents = [];
  const pages = [];
  for (const d of raw.documents) {
    const { pages: docPages, extraction, ...rest } = d;
    documents.push({
      ...rest,
      marked_corrected: Boolean(d.marked_corrected),
      extraction_status: extraction?.status ?? null,
      extraction_reason: extraction?.reason ?? null,
    });
    for (const p of docPages) {
      pages.push({
        doc_id: d.id,
        page: p.page,
        printed_content: p.printed_content,
        // Simulated today; a real scan later fills asset_url and flips render_kind.
        render_kind: 'simulated',
        asset_url: null,
      });
    }
  }
  return { documents, pages };
}

function projectEngine(raw) {
  const versions = [];
  const lines = [];
  const diagnostics = [];
  const assetBooks = [];
  for (const v of raw.return_versions) {
    const { lines: vLines, diagnostics: vDiag, assets, changes_from_previous, ...meta } = v;
    versions.push({ ...meta, assets, changes_from_previous });
    vLines.forEach((l, order) => lines.push({ version: v.version, order, ...l, note: l.note ?? null }));
    vDiag.forEach((g, i) => diagnostics.push({ version: v.version, seq: i, ...g }));
    for (const a of assets) {
      for (const book of Object.keys(JURISDICTION_BOOKS)) {
        if (!a[book]) continue;
        assetBooks.push({
          version: v.version,
          asset_id: a.asset_id,
          book,
          depreciation_2025: a[book].depreciation_2025 ?? null,
          prior_accumulated: a[book].prior_accumulated ?? null,
          accumulated_end: a[book].accumulated_end ?? null,
        });
      }
    }
  }
  return { versions, lines, diagnostics, assetBooks };
}

function projectPeriods(raw) {
  return raw.household.residency.map((r) => ({
    kind: 'residency',
    person_id: null, // residency applies to the whole household in this packet
    state: r.state,
    status: r.status,
    from: r.from,
    to: r.to,
  }));
}

function buildIndex(raw, projected) {
  const index = {
    documents: new Map(projected.documents.map((d) => [d.id, d])),
    pages: new Map(projected.pages.map((p) => [`${p.doc_id}#${p.page}`, p])),
    extractedValues: new Map(raw.extracted_values.map((e) => [e.id, e])),
    observations: new Map(projected.observations.map((o) => [o.id, o])),
    versions: new Map(projected.versions.map((v) => [v.version, v])),
    lines: new Map(projected.lines.map((l) => [`${l.version}|${l.key}`, l])),
  };
  return index;
}

/**
 * Loads a parsed packet. The input object is frozen in place (so callers cannot
 * mutate it afterwards) and every projection is frozen too.
 */
export function loadPacket(raw) {
  deepFreeze(raw);
  const { documents, pages } = projectDocuments(raw);
  const documentsById = new Map(documents.map((d) => [d.id, d]));
  const observations = buildObservations(raw, documentsById);
  const { versions, lines, diagnostics, assetBooks } = projectEngine(raw);
  const periods = projectPeriods(raw);
  const projected = { documents, pages, observations, versions, lines, diagnostics, assetBooks, periods };
  const index = buildIndex(raw, projected);
  return deepFreeze({
    raw,
    meta: raw.packet,
    people: raw.household.people,
    timeline: raw.timeline,
    ...projected,
    index,
  });
}
