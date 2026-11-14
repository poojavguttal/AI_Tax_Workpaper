// Acceptance gate for step 3 (check library): the 22 findings on the Packet
// findings tab fire with the right kind, lines, evidence and effect; the items the
// engine got right stay quiet; nothing is ever created closed.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacket } from '../src/domain/packet/index.js';
import { matchFacts } from '../src/domain/facts/index.js';
import { runChecks } from '../src/domain/checks/index.js';
import { readPacketText } from './helpers.js';

let packet;
let matched;
let run;
const byId = (id) => run.results.find((r) => r.id === id);

beforeAll(() => {
  packet = loadPacket(JSON.parse(readPacketText()));
  matched = matchFacts(packet);
  run = runChecks(packet, matched);
});

// finding # on the Packet findings tab -> [result id, kind, federal, california, payments]
const FINDINGS = [
  [1, 'lot_basis:F8949.B.N1', 'error', -6647, -1222],
  [1, 'lot_basis:F8949.B.N3', 'error', -6647, -1222],
  [1, 'lot_basis:F8949.E.N4', 'error', -2242, -320],
  [2, 'ca_wage_sourcing:SchCA540NR.1.E', 'error', 0, -5685],
  [3, 'double_counted:SchC.1', 'error', -4402, -384],
  [4, 'se_health_eligibility:Sch1.17', 'judgment', 4464, 605],
  [5, 'repair_or_improvement:SchE.14A:D47', 'judgment', 3633, 896],
  [6, 'fact_conflict:person:theo.ssn.value', 'conflict', 0, 0],
  [7, 'seller_tax_credit:SchA.5b', 'error', 1462, 332],
  [8, 'missing_basis:D34#1:C6', 'conflict', -1312, -195],
  [9, 'vehicle_donation_limit:F8283.A1.vehicle', 'error', 806, 149],
  [10, 'double_counted:SchC.44a', 'error', 919, 80],
  [11, 'double_counted:SchA.8a', 'error', 559, 103],
  [12, 'duplicate_lines:SchB.1.2', 'error', -640, -127],
  [13, 'mixed_use_expenses:SchC', 'judgment', 541, 47],
  [14, 'fx_rate_year:SchB.1.6', 'error', 43, 9],
  [15, 'unread_page:doc:D31#page32', 'error', -21, -2],
  [16, 'fact_conflict:payment:federal:2026-01-15.amount', 'conflict', 0, 0, { federal_payments: -1000 }],
  [17, 'payment_tax_year:payment:california:2025-09-15', 'error', 0, 0, { california_payments: -3500 }],
  [18, 'sep_excess:Sch1.16', 'judgment', 0, 0],
  [19, 'misread_value:ev-1045', 'error', 0, 0],
  [20, 'uncertain_read:ev-1049', 'conflict', 0, 0],
  [21, 'questionnaire_contradiction:qa-14:no_investment_sales', 'conflict', 0, 0],
  [22, 'questionnaire_contradiction:qa-31:no_prior_ira_basis', 'conflict', 0, 0],
];

describe('the 22 findings', () => {
  it.each(FINDINGS)('#%i %s is a %s with fed %i / CA %i', (n, id, kind, federal, california, payments) => {
    const r = byId(id);
    expect(r, id).toBeDefined();
    expect(r.kind).toBe(kind);
    expect(r.effect.federal).toBe(federal);
    expect(r.effect.california).toBe(california);
    if (payments) expect(r.effect).toMatchObject(payments);
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it('covers every finding number 1-22', () => {
    expect(new Set(FINDINGS.map((f) => f[0])).size).toBe(22);
  });

  it('points each error at the line and the evidence that prove it', () => {
    expect(byId('lot_basis:F8949.B.N1')).toMatchObject({ lines: ['v3|F8949.B.N1'], engine: 19240, expected: 140 });
    expect(byId('lot_basis:F8949.B.N1').evidence).toContain('ev-0066'); // D11 adjusted basis 19,100
    expect(byId('double_counted:SchC.1')).toMatchObject({ engine: 163700, expected: 151300, evidence: ['ev-0127', 'ev-0116'] });
    expect(byId('double_counted:SchC.44a')).toMatchObject({ lines: ['v3|SchC.44a', 'v3|SchC.9'], engine: 11800, expected: 8100 });
    expect(byId('ca_wage_sourcing:SchCA540NR.1.E')).toMatchObject({ engine: 218400, expected: 129569 });
    expect(byId('ca_wage_sourcing:SchCA540NR.1.E').evidence).toContain('ev-1081'); // D73 paystub
    expect(byId('seller_tax_credit:SchA.5b').evidence).toContain('ev-1027'); // D54 seller credit
    expect(byId('misread_value:ev-1045')).toMatchObject({ engine: '74-3829516', expected: '74-3829156', lines: ['v3|F2441.1b'] });
    expect(byId('fx_rate_year:SchB.1.6')).toMatchObject({ engine: 1747, expected: 1871 });
  });
});

describe('three kinds, never presented as equivalent', () => {
  it('errors carry no recommendation; they are closed by a correction', () => {
    for (const r of run.results.filter((x) => x.kind === 'error')) {
      expect(r.recommendation, r.id).toBeNull();
      expect(r.requires.action).toBe('correction');
    }
  });

  it('conflicts recommend which evidence to rely on, with the alternatives', () => {
    const q4 = byId('fact_conflict:payment:federal:2026-01-15.amount');
    expect(q4.recommendation.value).toBe(3000);
    expect(q4.alternatives.map((a) => a.treatment)).toEqual(['Use $3,000', 'Use $4,000']);
    const ssn = byId('fact_conflict:person:theo.ssn.value');
    expect(ssn.recommendation.value).toBe('666-74-3390');
    expect(ssn.message).toMatch(/rejects the e-file/);
    const c6 = byId('missing_basis:D34#1:C6');
    expect(c6.recommendation.treatment).toMatch(/3050/);
    expect(c6.evidence).toContain('msg-07');
    for (const r of run.results.filter((x) => x.kind === 'conflict')) expect(r.requires.action).toBe('decision');
  });

  it('judgments give a recommendation with its authority, and the alternatives with effects', () => {
    for (const r of run.results.filter((x) => x.kind === 'judgment')) {
      expect(r.recommendation?.treatment, r.id).toBeTruthy();
      expect(r.recommendation.authority, r.id).toBeTruthy();
      expect(r.requires).toMatchObject({ action: 'decision', authority: true });
    }
    const hvac = byId('repair_or_improvement:SchE.14A:D47');
    expect(hvac.alternatives.map((a) => a.effect.federal)).toEqual([0, 3633]);
    expect(hvac.evidence).toContain('call-01');
    expect(byId('se_health_eligibility:Sch1.17').evidence).toContain('qa-25');
  });

  it('every result is open, and a recommendation never closes it', () => {
    expect(run.results.every((r) => r.status === 'open')).toBe(true);
  });

  it('effects over the firm threshold need partner sign-off', () => {
    expect(byId('lot_basis:F8949.B.N1').requires.signoff).toBe('partner');
    expect(byId('repair_or_improvement:SchE.14A:D47').requires.signoff).toBe('partner');
    expect(byId('double_counted:SchA.8a').requires.signoff).toBe('reviewer');
  });
});

describe('no false positives on what the engine got right', () => {
  const touches = (pred) => run.results.filter((r) => ['error', 'conflict', 'judgment'].includes(r.kind)).filter(pred).map((r) => r.id);

  it.each([
    ['the W-2 phone photo is counted once', 'F1040.1a'],
    ['the escrow property tax is counted once', 'SchA.5b', 'seller_tax_credit:SchA.5b'],
    ['the S corporation basis roll with the 2023 K-1', 'F7203.'],
    ['the IRA conversion basis', 'F8606.'],
    ['the condo sale and freed passive losses', 'F4797.'],
    ['the ESPP lot (basis adjusted)', 'F8949.A.N2'],
    ['the Meridian lots after the correction', 'F8949.A.M'],
    ['the Brightpath lots and wash sales', 'F8949.A.X'],
  ])('%s', (_, linePrefix, except) => {
    expect(touches((r) => r.id !== except && r.check !== 'questionnaire_contradiction' && r.lines.some((l) => l.startsWith(`v3|${linePrefix}`)))).toEqual([]);
  });

  it('reports exactly these errors and conflicts', () => {
    expect(run.summary.byKind).toMatchObject({ error: 14, conflict: 6, judgment: 6 });
  });
});

describe('completeness and outside filings', () => {
  it('lists the documents that reach no line, linking those other findings rely on', () => {
    const docs = run.results.filter((r) => r.check === 'document_unaccounted').map((r) => r.subject);
    expect(docs).toEqual(['D01', 'D02', 'D03', 'D04', 'D05', 'D13', 'D47', 'D54', 'D71', 'D73']);
    expect(byId('document_unaccounted:D54').message).toMatch(/seller_tax_credit:SchA.5b/);
    expect(byId('document_unaccounted:D73').message).toMatch(/ca_wage_sourcing/);
  });

  it('links every engine diagnostic, and the warnings block filing', () => {
    const diags = run.results.filter((r) => r.check === 'engine_diagnostic');
    expect(diags).toHaveLength(11);
    expect(byId('engine_diagnostic:LOW_CONFIDENCE_READ').message).toMatch(/uncertain_read:ev-1049/);
    expect(byId('engine_diagnostic:BROKER_SUMMARY_DETAIL_MISMATCH').message).toMatch(/unread_page/);
    expect(byId('engine_diagnostic:AOTC_PHASED_OUT').blocking).toBe(false);
  });

  it('names the obligations outside this return, with due dates where the firm tracks them', () => {
    const out = run.results.filter((r) => r.kind === 'outside_filing');
    expect(out.map((r) => r.check).sort()).toEqual(['fbar', 'form_3520', 'forms_1099_nec', 'payment_transfer']);
    expect(byId('fbar:D36')).toMatchObject({ due: '2026-10-15', blocking: false });
    expect(byId('fbar:D36').message).toMatch(/149567 USD/);
  });
});

describe('versions and determinism', () => {
  it('on v1, flags lines that still use the Meridian values the correction replaced', () => {
    const v1 = runChecks(packet, matched, { version: 'v1' });
    const sup = v1.results.filter((r) => r.check === 'superseded_source').map((r) => r.subject);
    expect(sup.length).toBeGreaterThan(0);
    expect(sup.every((s) => s.startsWith('F8949.'))).toBe(true);
    expect(run.results.some((r) => r.check === 'superseded_source')).toBe(false);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(runChecks(packet, matched))).toBe(JSON.stringify(run));
  });
});
