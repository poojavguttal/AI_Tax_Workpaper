// Structural checks on a loaded packet. These are about the packet being loadable
// and traceable, not about tax correctness (that is the check library's job).
// Returns a list of problems; an empty list means every reference resolves.

import { resolveRef } from './refs.js';

export function checkIntegrity(packet) {
  const problems = [];
  const fail = (code, detail) => problems.push({ code, ...detail });

  const seen = new Set();
  for (const o of packet.observations) {
    if (seen.has(o.id)) fail('DUPLICATE_OBSERVATION_ID', { id: o.id });
    seen.add(o.id);
  }

  for (const d of packet.raw.documents) {
    if (d.page_count !== d.pages.length) fail('PAGE_COUNT_MISMATCH', { doc: d.id, page_count: d.page_count, pages: d.pages.length });
  }

  for (const ev of packet.raw.extracted_values) {
    if (!packet.index.pages.has(`${ev.document_id}#${ev.page}`)) fail('VALUE_ON_MISSING_PAGE', { id: ev.id, doc: ev.document_id, page: ev.page });
    const { x0, y0, x1, y1 } = ev.position ?? {};
    const inUnit = [x0, y0, x1, y1].every((n) => typeof n === 'number' && n >= 0 && n <= 1);
    if (!inUnit || x0 > x1 || y0 > y1) fail('BAD_POSITION', { id: ev.id });
  }

  for (const v of packet.versions) {
    for (const id of [...v.documents_used, ...v.documents_superseded]) {
      if (!packet.index.documents.has(id)) fail('UNKNOWN_DOCUMENT_IN_VERSION', { version: v.version, id });
    }
  }

  for (const line of packet.lines) {
    for (const input of line.inputs) {
      if (!resolveRef(packet, input, { version: line.version })) fail('UNRESOLVED_INPUT', { version: line.version, line: line.key, ref: input });
    }
    for (const src of line.sources) {
      if (!resolveRef(packet, src, { version: line.version })) fail('UNRESOLVED_SOURCE', { version: line.version, line: line.key, ref: src });
    }
  }

  for (const g of packet.diagnostics) {
    for (const ref of g.refs) {
      if (!resolveRef(packet, ref, { version: g.version })) fail('UNRESOLVED_DIAGNOSTIC_REF', { version: g.version, code: g.code, ref });
    }
  }

  for (const t of packet.timeline) {
    for (const ref of t.refs ?? []) {
      if (!resolveRef(packet, ref)) fail('UNRESOLVED_TIMELINE_REF', { id: t.id, ref });
    }
  }

  return problems;
}
