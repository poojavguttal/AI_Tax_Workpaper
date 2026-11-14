import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacket } from '../src/domain/packet/index.js';
import { toRows, PACKET_TABLES } from '../src/db/rows.js';
import { readPacketText, sha256 } from './helpers.js';

let rows;
beforeAll(() => {
  const text = readPacketText();
  rows = toRows(loadPacket(JSON.parse(text)), { sha256: sha256(text) });
});

const keyOf = {
  documents: (r) => r.id,
  pages: (r) => `${r.doc_id}#${r.page}`,
  observations: (r) => r.id,
  engine_versions: (r) => r.version,
  engine_lines: (r) => `${r.version}|${r.key}`,
  engine_diagnostics: (r) => `${r.version}|${r.seq}`,
  asset_books: (r) => `${r.version}|${r.asset_id}|${r.book}`,
  periods: (r) => r.seq,
};

describe('database rows', () => {
  it('produces rows for every packet table', () => {
    expect(Object.keys(rows).sort()).toEqual([...PACKET_TABLES].sort());
    expect(rows.packet_raw).toHaveLength(1);
    expect(rows.documents).toHaveLength(74);
    expect(rows.engine_lines).toHaveLength(625 + 625 + 627);
  });

  it('has unique primary keys in every table', () => {
    for (const [table, key] of Object.entries(keyOf)) {
      const keys = rows[table].map(key);
      expect(new Set(keys).size, table).toBe(keys.length);
    }
  });

  it('only references pages and documents that exist', () => {
    const docs = new Set(rows.documents.map((d) => d.id));
    const pages = new Set(rows.pages.map(keyOf.pages));
    for (const p of rows.pages) expect(docs.has(p.doc_id)).toBe(true);
    for (const o of rows.observations.filter((x) => x.doc_id)) expect(pages.has(`${o.doc_id}#${o.page}`)).toBe(true);
  });

  it('produces fact rows that satisfy the 0002 keys and foreign keys', async () => {
    const { matchFacts } = await import('../src/domain/facts/index.js');
    const { toFactRows } = await import('../src/db/rows.js');
    const packet = loadPacket(JSON.parse(readPacketText()));
    const fr = toFactRows(packet, matchFacts(packet));
    const activityIds = new Set(fr.activities.map((a) => a.id));
    const factIds = new Set(fr.facts.map((f) => f.id));
    const obsIds = new Set(rows.observations.map((o) => o.id));
    expect(factIds.size).toBe(fr.facts.length);
    expect(fr.facts.every((f) => activityIds.has(f.activity_id))).toBe(true);
    expect(new Set(fr.fact_observations.map((r) => r.observation_id)).size).toBe(rows.observations.length);
    expect(fr.fact_observations.every((r) => factIds.has(r.fact_id) && obsIds.has(r.observation_id))).toBe(true);
  });

  it('keeps the packet json intact in packet_raw', () => {
    expect(rows.packet_raw[0].json.documents).toHaveLength(74);
    expect(rows.packet_raw[0].id).toBe('CL-20417@1.0');
  });
});
