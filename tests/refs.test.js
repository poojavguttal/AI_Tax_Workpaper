import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacket, parseRef, resolveRef } from '../src/domain/packet/index.js';
import { readPacketText } from './helpers.js';

let packet;
beforeAll(() => { packet = loadPacket(JSON.parse(readPacketText())); });

describe('reference formats from the README', () => {
  it.each([
    ['ev-0016', 'extracted_value'],
    ['D09', 'document'],
    ['doc:D30#page32', 'page'],
    ['qa-41', 'questionnaire'],
    ['msg-07', 'message'],
    ['call-01', 'call_note'],
    ['py:/carryovers_into_2025/capital_loss_short', 'prior_year'],
    ['agency:/irs_account_transcript_2025/0/transactions/3', 'agency'],
    ['asset:SAC-BLDG', 'asset'],
    ['household:theo', 'person'],
    ['ref:param.mileage_rate', 'param'],
    ['ref:fx.SEK.2025_average', 'fx'],
    ['timeline:extension-2026-04-14', 'timeline'],
    ['v3', 'version'],
    ['F1040.1a', 'line'],
    ['F8949.A.N2', 'line'],
    ['SchCA540NR.1.E', 'line'],
  ])('%s parses as %s and resolves', (ref, kind) => {
    expect(parseRef(ref).kind).toBe(kind);
    expect(resolveRef(packet, ref, { version: 'v3' })).not.toBeNull();
  });

  it('resolves the page the pipeline never read', () => {
    const page = resolveRef(packet, 'doc:D30#page32').target;
    expect(page.printed_content).toContain('M18 Ironwood REIT');
  });

  it('resolves prior-year and agency pointers to their values', () => {
    expect(resolveRef(packet, 'py:/carryovers_into_2025/capital_loss_short').target).toBe(3200);
    expect(resolveRef(packet, 'agency:/irs_account_transcript_2025/0/transactions/3').target)
      .toMatchObject({ date: '2026-01-15', code: '670', amount: 3000 });
  });

  it('scopes line keys and assets to a version', () => {
    expect(resolveRef(packet, 'F1040.24', { version: 'v1' }).target.value).toBe(77200);
    expect(resolveRef(packet, 'F1040.24', { version: 'v3' }).target.value).toBe(81962);
    expect(resolveRef(packet, 'F1040.24')).toBeNull();
    expect(resolveRef(packet, 'asset:STU-PRINTER', { version: 'v3' })).not.toBeNull();
    expect(resolveRef(packet, 'asset:STU-PRINTER')).toBeNull(); // not a prior-year asset
  });

  it('returns null for refs that do not exist', () => {
    for (const ref of ['ev-9999', 'D99', 'qa-99', 'py:/nope', 'agency:/efile/9', 'household:zoe', 'ref:param.nope', 'nonsense']) {
      expect(resolveRef(packet, ref, { version: 'v3' })).toBeNull();
    }
  });
});

describe('observations carry the evidence the findings need', () => {
  it('keeps conflicting statements of the same fact side by side', () => {
    const o = packet.index.observations;
    // Theo's SSN: organizer vs prior-year return vs SS card.
    expect(o.get('household:theo.ssn').value).toBe('666-74-3309');
    expect(o.get('py:/return_2024/dependents/1/ssn').value).toBe('666-74-3390');
    const card = packet.observations.find((x) => x.doc_id === 'D71' && x.value_type === 'ssn');
    expect(card.value).toBe('666-74-3390');
    // Federal Q4 estimate: client guess vs IRS transcript.
    expect(o.get('qa-41').value).toContain('4,000');
    expect(o.get('agency:/irs_account_transcript_2025/0/transactions/3').value).toBe(3000);
  });
});
