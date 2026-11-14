// Parses and resolves every reference format the packet README defines, so any
// `sources`, `inputs`, diagnostic or timeline ref can be followed to its record.

import { getAtPointer } from './pointer.js';

const PATTERNS = [
  ['extracted_value', /^ev-\d{4}$/],
  ['document', /^D\d{2}$/],
  ['page', /^doc:(D\d{2})#page(\d+)$/],
  ['questionnaire', /^qa-\d{2}$/],
  ['message', /^msg-\d{2}$/],
  ['call_note', /^call-\d{2}$/],
  ['prior_year', /^py:(\/.*)$/],
  ['agency', /^agency:(\/.*)$/],
  ['asset', /^asset:(.+)$/],
  ['person', /^household:(.+)$/],
  ['param', /^ref:param\.(.+)$/],
  ['fx', /^ref:fx\.([A-Z]{3})\.(.+)$/],
  ['timeline', /^timeline:(.+)$/],
  ['version', /^v\d+$/],
  ['line', /^[A-Za-z0-9-]+\.[A-Za-z0-9.-]+$/],
];

/** Classifies a reference string. Returns { kind, ref, ...parts } or { kind: 'unknown', ref }. */
export function parseRef(ref) {
  for (const [kind, re] of PATTERNS) {
    const m = re.exec(ref);
    if (!m) continue;
    switch (kind) {
      case 'page': return { kind, ref, docId: m[1], page: Number(m[2]) };
      case 'prior_year':
      case 'agency': return { kind, ref, pointer: m[1] };
      case 'asset':
      case 'person':
      case 'param':
      case 'timeline': return { kind, ref, id: m[1] };
      case 'fx': return { kind, ref, currency: m[1], rate: m[2] };
      default: return { kind, ref };
    }
  }
  return { kind: 'unknown', ref };
}

/**
 * Resolves a reference against a loaded packet. `version` scopes line keys and
 * asset ids to one engine version. Returns { kind, ref, target } or null.
 */
export function resolveRef(packet, ref, { version } = {}) {
  const p = parseRef(ref);
  const hit = (target) => (target === undefined || target === null ? null : { kind: p.kind, ref, target });
  const { raw, index } = packet;

  switch (p.kind) {
    case 'extracted_value': return hit(index.extractedValues.get(ref));
    case 'document': return hit(index.documents.get(ref));
    case 'page': return hit(index.pages.get(`${p.docId}#${p.page}`));
    case 'questionnaire': return hit(raw.client.questionnaire.find((q) => q.id === ref));
    case 'message': return hit(raw.client.messages.find((m) => m.id === ref));
    case 'call_note': return hit(raw.client.call_notes.find((c) => c.id === ref));
    case 'prior_year': return hit(getAtPointer(raw.prior_years, p.pointer));
    case 'agency': return hit(getAtPointer(raw.tax_agency_records, p.pointer));
    case 'asset': {
      const scoped = version && index.versions.get(version)?.assets.find((a) => a.asset_id === p.id);
      return hit(scoped || raw.prior_years.asset_records.find((a) => a.asset_id === p.id));
    }
    case 'person': return hit(raw.household.people.find((x) => x.id === p.id));
    case 'param': return hit(raw.engine_reference.parameters[p.id]);
    case 'fx': return hit(raw.engine_reference.parameters.fx?.[p.currency]?.[p.rate]);
    case 'timeline': return hit(raw.timeline.find((t) => t.id === p.id));
    case 'version': return hit(index.versions.get(ref));
    case 'line': return version ? hit(index.lines.get(`${version}|${ref}`)) : null;
    default: return null;
  }
}
