// Acceptance gate for step 1 (packet ingestion):
// all 74 documents, every observation, all three engine versions load; every
// reference resolves; and the packet is unchanged by loading.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacket, checkIntegrity, resolveRef } from '../src/domain/packet/index.js';
import { readPacketText, sha256 } from './helpers.js';

let text;
let packet;

beforeAll(() => {
  text = readPacketText();
  packet = loadPacket(JSON.parse(text));
});

describe('packet ingestion', () => {
  it('is the packet as delivered', () => {
    expect(sha256(text)).toBe('ee01f8508bd2fd9854754b82fd9c4a055bdc55e2778a132002a25381c412ad19');
    expect(packet.meta.client_id).toBe('CL-20417');
  });

  it('loads all 74 documents and every page', () => {
    expect(packet.documents).toHaveLength(74);
    const declaredPages = packet.raw.documents.reduce((n, d) => n + d.page_count, 0);
    expect(packet.pages).toHaveLength(declaredPages);
    expect(packet.pages.every((p) => p.render_kind === 'simulated' && typeof p.printed_content === 'string')).toBe(true);
  });

  it('keeps extraction status per document, including the partial and unread ones', () => {
    const byStatus = Object.groupBy(packet.documents, (d) => d.extraction_status);
    expect(byStatus.extracted).toHaveLength(68);
    expect(byStatus.partial.map((d) => d.id).sort()).toEqual(['D30', 'D31']);
    expect(byStatus.not_extracted.map((d) => d.id).sort()).toEqual(['D07', 'D69', 'D70', 'D72']);
  });

  it('turns every source record into an observation with a unique id', () => {
    const kinds = Object.groupBy(packet.observations, (o) => o.source_kind);
    expect(kinds.doc_value).toHaveLength(3012);
    expect(kinds.client.length).toBeGreaterThanOrEqual(45 + 10 + 1);
    expect(kinds.agency.length).toBeGreaterThan(0);
    expect(kinds.prior_year.length).toBeGreaterThan(0);
    expect(new Set(packet.observations.map((o) => o.id)).size).toBe(packet.observations.length);
  });

  it('loads all three engine versions line for line', () => {
    const counts = Object.fromEntries(packet.versions.map((v) => [v.version, packet.lines.filter((l) => l.version === v.version).length]));
    expect(counts).toEqual({ v1: 625, v2: 625, v3: 627 });
    for (const v of ['v1', 'v2', 'v3']) {
      const keys = packet.lines.filter((l) => l.version === v).map((l) => l.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(packet.diagnostics.filter((g) => g.version === 'v3')).toHaveLength(11);
  });

  it('projects asset books for federal, California and AMT', () => {
    const v3 = packet.assetBooks.filter((b) => b.version === 'v3');
    expect(new Set(v3.map((b) => b.asset_id)).size).toBe(9);
    expect(new Set(v3.map((b) => b.book))).toEqual(new Set(['federal', 'california', 'amt']));
    const printerCA = v3.find((b) => b.asset_id === 'STU-PRINTER' && b.book === 'california');
    expect(printerCA.depreciation_2025).toBe(2840);
  });

  it('records residency periods from the household', () => {
    expect(packet.periods.map((p) => [p.state, p.from, p.to])).toEqual([
      ['CA', '2025-01-01', '2025-07-14'],
      ['TX', '2025-07-15', '2025-12-31'],
    ]);
  });

  it('resolves every reference in every version, diagnostic and timeline event', () => {
    expect(checkIntegrity(packet)).toEqual([]);
  });

  it('reports refs that do not resolve (negative control)', () => {
    const broken = JSON.parse(text);
    broken.return_versions[2].lines[0].sources.push('ev-9999');
    broken.return_versions[2].lines[1].inputs.push('F1040.zz');
    broken.timeline[0].refs.push('D99');
    const codes = checkIntegrity(loadPacket(broken)).map((p) => `${p.code} ${p.ref}`);
    expect(codes).toEqual(['UNRESOLVED_SOURCE ev-9999', 'UNRESOLVED_INPUT F1040.zz', 'UNRESOLVED_TIMELINE_REF D99']);
  });

  it('can trace a line to the exact field on its source page', () => {
    const line = packet.index.lines.get('v3|F1040.1a');
    const sources = line.sources.map((s) => resolveRef(packet, s, { version: 'v3' }));
    expect(sources.map((s) => [s.target.document_id, s.target.page, s.target.field])).toEqual([
      ['D08', 1, 'box1'],
      ['D09', 1, 'box1'],
    ]);
    const page = packet.index.pages.get('D09#1');
    expect(page.printed_content).toContain(sources[1].target.text_as_read);
  });

  it('leaves the packet unchanged and refuses mutation', () => {
    expect(sha256(JSON.stringify(packet.raw))).toBe(sha256(JSON.stringify(JSON.parse(text))));
    expect(Object.isFrozen(packet.raw.documents[0])).toBe(true);
    expect(() => { 'use strict'; packet.raw.documents[0].title = 'x'; }).toThrow(TypeError);
    expect(() => { packet.observations.push({}); }).toThrow(TypeError);
  });
});
