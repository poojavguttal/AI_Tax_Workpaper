// Everything immutable, computed once in the browser: the packet as delivered, the
// facts, the check results and the reducer base. UI indexes live here too.

import raw from '../../../data/packet.json';
import { loadPacket, resolveRef, parseRef } from '../../domain/packet/index.js';
import { matchFacts } from '../../domain/facts/index.js';
import { runChecks } from '../../domain/checks/index.js';
import { makeBase } from '../../domain/events/index.js';

export const packet = loadPacket(raw);
export const matched = matchFacts(packet);
export const checks = runChecks(packet, matched);
export const base = makeBase(packet, matched, checks);
export const VERSION = checks.version;

export const factById = new Map(matched.facts.map((f) => [f.id, f]));
export const factOfObs = new Map();
for (const f of matched.facts) for (const m of f.members) factOfObs.set(m.obs, { fact: f, member: m });

export const linesOf = (version = VERSION) => packet.lines.filter((l) => l.version === version);
export const line = (key, version = VERSION) => packet.index.lines.get(`${version}|${key}`);

/** obs id -> v3 lines citing it */
export const citedBy = new Map();
for (const l of linesOf()) for (const s of l.sources) citedBy.set(s, [...(citedBy.get(s) ?? []), l]);

/** line key -> lines that use it as an input */
export const consumersOf = new Map();
for (const l of linesOf()) for (const i of l.inputs) consumersOf.set(i, [...(consumersOf.get(i) ?? []), l]);

/** line key -> check results that point at it */
export const resultsByLine = new Map();
for (const r of checks.results) for (const k of r.lines) {
  const key = k.split('|')[1];
  resultsByLine.set(key, [...(resultsByLine.get(key) ?? []), r.id]);
}

/** doc id -> lines its observations (or the facts they belong to) reach */
export function landingsOfDoc(docId) {
  const obs = packet.observations.filter((o) => o.doc_id === docId);
  const out = new Map();
  for (const o of obs) {
    const fm = factOfObs.get(o.id);
    const members = fm ? fm.fact.members.map((m) => m.obs) : [o.id];
    for (const m of members) for (const l of citedBy.get(m) ?? []) {
      if (!out.has(l.key)) out.set(l.key, { line: l, via: new Set() });
      out.get(l.key).via.add(o.id);
    }
  }
  return [...out.values()].map((x) => ({ line: x.line, via: [...x.via] }));
}

export const relationsOfDoc = (docId) => matched.relations.filter((r) => r.doc === docId || r.of === docId);
export const dispositionOfDoc = (docId) => matched.dispositions.find((d) => d.doc_id === docId);

/** How a document stands, for the index. */
export function docStatus(doc) {
  const rel = matched.relations;
  if (rel.some((r) => r.kind === 'supersedes' && r.of === doc.id)) return { key: 'superseded', label: 'Superseded' };
  if (rel.some((r) => r.kind === 'duplicate_document' && r.doc === doc.id)) return { key: 'duplicate', label: 'Duplicate' };
  if (dispositionOfDoc(doc.id)) return { key: 'not_extracted', label: 'Not extracted' };
  if (doc.extraction_status === 'partial') return { key: 'partial', label: 'Page unread' };
  if (landingsOfDoc(doc.id).length) return { key: 'used', label: 'On return' };
  return { key: 'unaccounted', label: 'Needs disposition' };
}

export { resolveRef, parseRef };

export const actorsList = [
  ...packet.raw.firm.staff.map((s) => ({ ...s, kind: 'staff' })),
  ...packet.raw.firm.client_users.map((c) => ({ ...c, kind: 'client' })),
];
export const actorById = new Map(actorsList.map((a) => [a.id, a]));

export const activities = new Map(matched.activities.map((a) => [a.id, a]));

