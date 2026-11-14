// Acceptance gate for step 2 (fact matching):
// the known duplicates and the corrected Meridian 1099 are found by content rules,
// every observation sits in exactly one fact, and every document is accounted for.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacket } from '../src/domain/packet/index.js';
import { matchFacts, parseAmounts, parseDates } from '../src/domain/facts/index.js';
import { readPacketText } from './helpers.js';

let packet;
let result;
const fact = (id) => result.facts.find((f) => f.id === id);
const membersOf = (id) => fact(id).members.map((m) => [m.obs, m.role]);
const rel = (kind) => result.relations.filter((r) => r.kind === kind).map(({ rule, overlap, changed, ...r }) => r);

beforeAll(() => {
  packet = loadPacket(JSON.parse(readPacketText()));
  result = matchFacts(packet);
});

describe('document relations', () => {
  it('finds exactly one re-uploaded document: the Halvorsen W-2 phone photo', () => {
    expect(rel('duplicate_document')).toEqual([{ kind: 'duplicate_document', doc: 'D10', of: 'D09' }]);
    expect(membersOf('D09#1:box1')).toEqual([['ev-0035', 'primary'], ['ev-0052', 'duplicate']]);
  });

  it('finds exactly one supersession: the CORRECTED Meridian 1099, with the four values it changed', () => {
    const [s] = result.relations.filter((r) => r.kind === 'supersedes');
    expect(result.relations.filter((r) => r.kind === 'supersedes')).toHaveLength(1);
    expect([s.doc, s.of]).toEqual(['D31', 'D30']);
    expect(s.changed.map((c) => `${c.fact}.${c.field}: ${c.from} -> ${c.to}`)).toEqual([
      'D31#4:M6.wash: 735 -> 512',
      'D31#6:M9.basis: 6900 -> 4880',
      'D31#8:M14.acquired: 2024-10-15 -> 2024-09-15',
      'D31#8:M14.term: short -> long',
    ]);
    expect(result.facts.some((f) => f.home?.doc_id === 'D30')).toBe(false);
  });

  it('finds exactly one rescanned page: mileage log page 3 repeats page 2', () => {
    expect(rel('duplicate_page')).toEqual([{ kind: 'duplicate_page', doc: 'D23', page: 3, of_page: 2 }]);
    expect(membersOf('D23#2:page_total')).toEqual([['ev-0315', 'primary'], ['ev-0404', 'duplicate']]);
    expect(result.facts.some((f) => f.home?.doc_id === 'D23' && f.home.page === 3)).toBe(false);
  });
});

describe('one fact, several documents', () => {
  it('Northlake sweep interest on the composite and the standalone 1099-INT is one fact', () => {
    expect(membersOf('D28#1:int_1')).toEqual([['ev-0492', 'primary'], ['ev-0538', 'duplicate']]);
    expect(fact('D28#1:int_1').status).toBe('corroborated');
  });

  it('payoff interest is already inside the Lonestar 1098 box 1', () => {
    expect(membersOf('D55#1:box1')).toEqual([['ev-1029', 'primary'], ['ev-1032', 'included_in']]);
  });

  it('home property tax paid from escrow is one payment on the 1098 and the county receipt', () => {
    expect(membersOf('D57#1:box10')).toEqual([['ev-1036', 'primary'], ['ev-1038', 'duplicate']]);
  });

  it('Fremont escrow installments add up to the 1098 box 10', () => {
    expect(membersOf('D48#1:box10')).toEqual([['ev-1007', 'primary'], ['ev-1008', 'component'], ['ev-1009', 'component']]);
    expect(fact('D48#1:box10').componentChecks).toEqual([{ field: 'value', sum: 6240, total: 6240, ok: true }]);
  });

  it('the 1099-K card receipts are part of the Atlas 1099-NEC, per the books', () => {
    expect(membersOf('D17#1:box1')).toEqual([
      ['ev-0116', 'primary'], ['ev-0127', 'included_in'], ['ev-0109', 'included_in'], ['ev-0110', 'supporting'],
    ]);
    expect(fact('D17#1:box1').status).toBe('corroborated');
  });

  it('a lot takes its cost basis from the stock plan supplement or the broker export', () => {
    expect(fact('D28#3:N1').fields).toMatchObject({ proceeds: 19240, basis: 0, adjusted_basis: 19100 });
    expect(fact('D28#3:N4').fields).toMatchObject({ basis: 0, adjusted_basis: 9420 });
    expect(fact('D34#1:C1').fields).toMatchObject({ proceeds: 3940, basis: 912, acquired: '2023-02-11' });
  });

  it('2024 return lines carry the values read off the 2024 return document', () => {
    const f = fact('py:/return_2024/lines/F1040.1a');
    expect(f.members.map((m) => m.role)).toEqual(['primary', 'duplicate']);
    expect(f.status).toBe('corroborated');
  });
});

describe('disagreements surface as conflicts, whatever the confidence', () => {
  it('Theo: organizer SSN against the 2024 return and the Social Security card', () => {
    const f = fact('person:theo.ssn');
    expect(f.status).toBe('conflict');
    expect(f.conflicts[0].values.map((v) => [v.obs, v.value])).toEqual([
      ['household:theo.ssn', '666-74-3309'],
      ['py:/return_2024/dependents/1/ssn', '666-74-3390'],
      ['ev-0012', '666-74-3390'],
      ['ev-1080', '666-74-3390'],
    ]);
  });

  it('federal Q4 estimate: the client remembers 4,000 on 01/14, the IRS has 3,000 on 01/15', () => {
    const f = fact('payment:federal:2026-01-15');
    expect(f.status).toBe('conflict');
    expect(f.conflicts[0].values.map((v) => [v.obs, v.value])).toEqual([
      ['agency:/irs_account_transcript_2025/0/transactions/3', 3000],
      ['agency:/irs_account_transcript_2025/1/transactions/3', 3000],
      ['qa-41', 4000],
    ]);
  });

  it('agrees the first three federal estimates across EFTPS and the transcript', () => {
    for (const d of ['2025-04-15', '2025-06-16', '2025-09-15']) {
      expect(fact(`payment:federal:${d}`).status, d).toBe('corroborated');
    }
  });

  it('keeps the 09/15 Web Pay with its tax-year designation (2024) for the checks to judge', () => {
    expect(fact('payment:california:2025-09-15').fields).toMatchObject({ amount: 3500, year: '2024' });
  });

  it('flags the crypto lot with no cost basis as incomplete', () => {
    expect(result.facts.filter((f) => f.status === 'incomplete').map((f) => [f.id, f.incomplete]))
      .toEqual([['D34#1:C6', ['acquired', 'basis']]]);
  });

  it('only the two real disagreements are conflicts (no false positives)', () => {
    expect(result.facts.filter((f) => f.status === 'conflict').map((f) => f.id).sort())
      .toEqual(['payment:federal:2026-01-15', 'person:theo.ssn']);
  });
});

describe('completeness', () => {
  it('puts every observation in exactly one fact', () => {
    const seen = new Map();
    for (const f of result.facts) for (const m of f.members) seen.set(m.obs, (seen.get(m.obs) ?? 0) + 1);
    expect(seen.size).toBe(packet.observations.length);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  it('accounts for every document: it has facts, or it is a duplicate/superseded copy, or it has a disposition', () => {
    const inFacts = new Set();
    for (const f of result.facts) for (const m of f.members) {
      const o = packet.index.observations.get(m.obs);
      if (o.doc_id) inFacts.add(o.doc_id);
    }
    const disposed = new Set(result.dispositions.map((d) => d.doc_id));
    const unaccounted = packet.documents.filter((d) => !inFacts.has(d.id) && !disposed.has(d.id)).map((d) => d.id);
    expect(unaccounted).toEqual([]);
    expect([...disposed].sort()).toEqual(['D07', 'D69', 'D70', 'D72']);
  });

  it('routes every document and fact to an activity that exists', () => {
    const ids = new Set(result.activities.map((a) => a.id));
    expect(packet.documents.every((d) => ids.has(result.docActivity.get(d.id)))).toBe(true);
    expect(result.facts.every((f) => ids.has(f.activity))).toBe(true);
  });

  it('routes documents by content, not by id', () => {
    const route = (id) => result.docActivity.get(id);
    expect(['D46', 'D47', 'D48', 'D49'].map(route)).toEqual(Array(4).fill('rental:fremont'));
    expect(['D50', 'D51', 'D52', 'D53'].map(route)).toEqual(Array(4).fill('rental:condo'));
    expect(['D54', 'D55', 'D56', 'D57', 'D58'].map(route)).toEqual(Array(5).fill('home'));
    expect([route('D28'), route('D29')]).toEqual(['investments:northlake', 'investments:northlake']);
    expect(route('D22')).toBe('studio');
    expect(route('D40')).toBe('passthrough:lindqvist');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(matchFacts(packet))).toBe(JSON.stringify(result));
  });
});

describe('text parsing', () => {
  it('reads amounts without mistaking dates or years for them', () => {
    expect(parseAmounts('Paid January 14, 2026 - 4,000 I think.')).toEqual([4000]);
    expect(parseAmounts('total 13,420.00 paid 12/18/2025')).toEqual([13420]);
    expect(parseDates('Paid January 14, 2026 - 4,000 I think.')).toEqual(['2026-01-14']);
  });
});
