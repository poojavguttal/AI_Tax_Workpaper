// The deterministic reducer: reduce(base, events) -> workpaper state.
// `base` is the immutable packet plus seeded facts and check results; `events` is
// the append-only log. Invalid events are kept in the log but rejected here with a
// reason, so the state never depends on anything but the log.

import { contentHash } from './hash.js';
import { actorsFrom, CAN } from './people.js';

const CLOSES = { correction: 'correct', decision: 'decide', disposition: 'dispose', explanation: 'explain', acknowledgement: 'acknowledge' };
const CONTENT_KINDS = new Set(['correct', 'decide', 'dismiss', 'dispose', 'explain', 'acknowledge', 'adjust', 'revert']);
const DERIVED_STEPS = {
  'All documents accounted for': (s) => itemsDone(s, (r) => r.check === 'document_unaccounted'),
  'Prior-year variances explained': (s) => itemsDone(s, (r) => r.check === 'prior_year_variance'),
  'Diagnostics resolved': (s) => itemsDone(s, (r) => r.check === 'engine_diagnostic'),
  'Estimated payments agreed to IRS and FTB records': (s) => itemsDone(s, (r) => r.check === 'payment_tax_year' || r.id.startsWith('fact_conflict:payment:')),
  'Reviewer sign-off': (s) => returnSignoffValid(s, 'reviewer'),
  'Partner sign-off': (s) => returnSignoffValid(s, 'partner'),
  'Client approval and e-file authorization': (s) => clientApprovalValid(s),
};

const sumEffects = (effects) => effects.reduce((t, e) => ({
  federal: t.federal + (e?.federal ?? 0),
  california: t.california + (e?.california ?? 0),
  federal_payments: t.federal_payments + (e?.federal_payments ?? 0),
  california_payments: t.california_payments + (e?.california_payments ?? 0),
}), { federal: 0, california: 0, federal_payments: 0, california_payments: 0 });

// ---------------------------------------------------------------------------
// Derived values

function itemHash(item) {
  const c = item.closing;
  return contentHash({
    id: item.result.id, expected: item.result.expected, effect: item.result.effect, evidence: item.result.evidence,
    closing: c && { id: c.id, kind: c.kind, actor: c.actor, payload: c.payload },
  });
}

function requiredLevels(item) {
  return item.result.requires.signoff === 'partner' ? ['reviewer', 'partner'] : ['reviewer'];
}

function itemStatus(item) {
  if (!item.closing) return 'open';
  const hash = itemHash(item);
  const valid = (level) => item.signoffs.some((s) => s.payload.level === level && s.hash === hash);
  if (requiredLevels(item).every(valid)) return 'closed';
  // Reopened only when something signed has since changed; partial valid sign-off is still waiting.
  return item.signoffs.some((s) => s.hash !== hash) ? 'reopened' : 'awaiting_signoff';
}

function itemsDone(state, pred) {
  return [...state.items.values()].filter((i) => pred(i.result)).every((i) => itemStatus(i) === 'closed');
}

/** The effect of an item's active closing event on the return. */
function closingEffect(item) {
  const c = item.closing;
  if (!c) return null;
  if (c.kind === 'correct') return item.result.effect;
  if (c.kind === 'decide') return item.result.alternatives[c.payload.alternative]?.effect ?? null;
  if (c.kind === 'adjust') return c.payload.effect;
  return null;
}

function computeReturn(state) {
  const { base } = state;
  const items = [...state.items.values()];
  const delta = sumEffects(items.map(closingEffect));
  const s = base.version.summary;
  const federal = { total_tax: s.federal.total_tax + delta.federal, payments: s.federal.payments + delta.federal_payments };
  const california = { total_tax: s.california.total_tax + delta.california, payments: s.california.payments + delta.california_payments };
  federal.balance_due = federal.total_tax - federal.payments;
  california.balance_due = california.total_tax - california.payments;

  // Line values: engine value, replaced where a correction or decision states the corrected value.
  const lines = new Map();
  const set = (key, value, eventId) => {
    const engine = base.lines.get(key)?.value;
    lines.set(key, { key, engine, effective: value, events: [...(lines.get(key)?.events ?? []), eventId] });
  };
  for (const item of items) {
    const c = item.closing;
    if (!c) continue;
    const r = item.result;
    if (c.kind === 'correct' && typeof r.expected === 'number' && r.lines.length) set(r.lines[0].split('|')[1], r.expected, c.id);
    if (c.kind === 'adjust') set(c.target.slice('line:'.length), c.payload.value, c.id);
    if (c.kind === 'decide') {
      const alt = r.alternatives[c.payload.alternative];
      const whatIf = alt?.what_if && base.packet.raw.what_if.alternatives.find((w) => w.id === alt.what_if);
      for (const ch of whatIf?.changed_lines ?? []) set(ch.key, ch.new, c.id);
      const pay = alt?.effect?.federal_payments ?? alt?.effect?.california_payments;
      if (pay && r.lines.length) {
        const key = r.lines[0].split('|')[1];
        set(key, (lines.get(key)?.effective ?? base.lines.get(key).value) + pay, c.id);
      }
    }
  }
  return {
    engine: { federal: s.federal, california: s.california },
    effective: { federal, california },
    delta,
    lines: [...lines.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    method: 'Engine totals plus each accepted item\'s estimated effect (tax_effect_rates or what_if); the engine is not rerun.',
  };
}

function returnHash(state) {
  const ret = computeReturn(state);
  return contentHash({
    effective: ret.effective, lines: ret.lines.map((l) => [l.key, l.effective]),
    items: [...state.items.values()].map((i) => [i.result.id, i.closing?.id ?? null]),
  });
}

function returnSignoffValid(state, level) {
  const h = returnHash(state);
  return state.returnSignoffs.some((s) => s.payload.level === level && s.hash === h);
}

function clientApprovalValid(state) {
  const h = returnHash(state);
  return state.approvals.some((a) => a.hash === h);
}

function steps(state) {
  return state.base.requiredSteps.map((name) => {
    const derived = DERIVED_STEPS[name];
    const done = derived ? derived(state) : state.steps.has(name);
    return { name, done, derived: Boolean(derived), event: state.steps.get(name)?.id ?? null };
  });
}

/** Everything that stands between this state and filing. */
export function blockers(state) {
  const out = [];
  for (const item of state.items.values()) {
    const status = itemStatus(item);
    if (item.result.blocking && status !== 'closed') out.push({ type: 'item', id: item.result.id, kind: item.result.kind, status });
  }
  for (const n of state.notes.values()) if (n.payload.blocking && !n.resolved) out.push({ type: 'note', id: n.id, text: n.payload.text });
  for (const s of steps(state)) if (!s.done) out.push({ type: 'step', id: s.name });
  if (state.filed) out.push({ type: 'frozen', id: state.filed.id });
  return out;
}

// ---------------------------------------------------------------------------
// Validation: returns a reason string when the event must be rejected.

function validate(state, e) {
  const actor = state.actors.get(e.actor);
  if (!actor) return 'unknown actor';
  if (actor.active_from && e.at.slice(0, 10) < actor.active_from) return `${actor.name} is not active until ${actor.active_from}`;
  const role = actor.role;
  if (state.filed && CONTENT_KINDS.has(e.kind)) return 'the return is filed and frozen; changes go on an amendment';
  const item = state.items.get(e.target);

  switch (e.kind) {
    case 'correct': case 'decide': case 'dispose': case 'explain': case 'acknowledge': {
      if (!CAN.prepare.has(role)) return `${role} cannot ${e.kind}`;
      if (!item) return `no item ${e.target}`;
      const expected = CLOSES[item.result.requires.action];
      if (expected !== e.kind) return `${item.result.kind} items are closed by ${expected}, not ${e.kind}`;
      if (e.kind === 'decide') {
        if (!item.result.alternatives[e.payload?.alternative]) return 'choose one of the listed alternatives';
        if (!e.payload.rationale) return 'a decision records its rationale';
        if (item.result.requires.authority && !e.payload.authority) return 'a judgment call records the authority relied on';
      }
      if (['dispose', 'explain', 'acknowledge'].includes(e.kind) && !(e.payload?.reason ?? e.payload?.explanation ?? e.payload?.note)) return 'say why';
      return null;
    }
    case 'dismiss':
      if (!CAN.oversee.has(role)) return 'only a reviewer or partner can dismiss a finding';
      if (!item) return `no item ${e.target}`;
      if (!e.payload?.reason) return 'a dismissal records why the finding does not apply';
      return null;
    case 'adjust':
      if (!CAN.prepare.has(role)) return `${role} cannot adjust`;
      if (!e.target?.startsWith('line:') || !state.base.lines.has(e.target.slice(5))) return 'adjust targets an existing line:KEY';
      if (!e.payload?.reason || !e.payload?.effect) return 'an adjustment records its reason and tax effect';
      return null;
    case 'verify':
      if (!CAN.prepare.has(role)) return `${role} cannot verify`;
      if (!state.base.verificationTypes.includes(e.payload?.type)) return `verification type must be one of: ${state.base.verificationTypes.join(', ')}`;
      return null;
    case 'signoff': {
      const level = e.payload?.level;
      if (!CAN.signoff[level]?.has(role)) return `${role} cannot sign off at ${level} level`;
      if (e.target === 'return') {
        const authored = [...state.items.values()].some((i) => i.closing?.actor === e.actor);
        if (authored) return 'cannot sign off a return containing work you prepared';
        return null;
      }
      if (!item) return `no item ${e.target}`;
      if (!item.closing) return 'nothing to sign off: the item has no correction or decision yet';
      if (item.closing.actor === e.actor) return 'cannot review or sign off work you prepared';
      if (!requiredLevels(item).includes(level)) return `this item needs ${requiredLevels(item).join(' and ')} sign-off`;
      return null;
    }
    case 'note':
      if (!CAN.note.has(role) && actor.kind !== 'client') return `${role} cannot write notes`;
      if (!e.payload?.text) return 'a note needs text';
      return null;
    case 'resolve_note': {
      const n = state.notes.get(e.target);
      if (!n) return `no note ${e.target}`;
      if (n.actor !== e.actor && !CAN.oversee.has(role)) return 'only the author, a reviewer or a partner can resolve a note';
      return null;
    }
    case 'complete_step':
      if (!CAN.prepare.has(role)) return `${role} cannot complete steps`;
      if (!state.base.requiredSteps.includes(e.target)) return `no required step "${e.target}"`;
      if (DERIVED_STEPS[e.target]) return `"${e.target}" completes itself when its items are closed`;
      return null;
    case 'client_approval':
      if (!CAN.approve.has(role)) return 'only the client approves the return';
      if (!returnSignoffValid(state, 'partner')) return 'the partner has not signed off the current return';
      return null;
    case 'view_sensitive':
      if (actor.kind !== 'staff') return 'only firm staff view unmasked data';
      if (!actor.sensitive_data_clearance) return `${actor.name} has no sensitive-data clearance`;
      if (!e.payload?.field) return 'say which field was viewed';
      return null;
    case 'file': {
      if (!CAN.file.has(role)) return `${role} cannot file`;
      const b = blockers(state);
      return b.length ? `${b.length} blocker(s) remain, e.g. ${b[0].type} ${b[0].id}` : null;
    }
    default:
      return `unknown event kind ${e.kind}`;
  }
}

// ---------------------------------------------------------------------------
// Application

function apply(state, e) {
  switch (e.kind) {
    case 'correct': case 'decide': case 'dismiss': case 'dispose': case 'explain': case 'acknowledge':
      state.items.get(e.target).closing = e;
      break;
    case 'adjust': {
      const effect = e.payload.effect;
      const largest = Math.max(Math.abs(effect.federal ?? 0), Math.abs(effect.california ?? 0));
      state.items.set(`adjustment:${e.id}`, {
        result: {
          id: `adjustment:${e.id}`, check: 'adjustment', kind: 'adjustment', title: e.payload.reason, blocking: true,
          lines: [`${state.base.versionId}|${e.target.slice(5)}`], evidence: e.payload.evidence ?? [], expected: e.payload.value, effect,
          alternatives: [], requires: { action: 'correction', authority: false, signoff: largest > state.base.partnerThreshold ? 'partner' : 'reviewer' },
        },
        closing: e, signoffs: [],
      });
      break;
    }
    case 'verify':
      state.verifications.set(e.target, [...(state.verifications.get(e.target) ?? []), e]);
      break;
    case 'signoff':
      if (e.target === 'return') state.returnSignoffs.push({ ...e, hash: returnHash(state) });
      else {
        const item = state.items.get(e.target);
        item.signoffs.push({ ...e, hash: itemHash(item) });
      }
      break;
    case 'note':
      state.notes.set(e.id, { ...e, resolved: null });
      break;
    case 'resolve_note':
      state.notes.get(e.target).resolved = e;
      break;
    case 'complete_step':
      state.steps.set(e.target, e);
      break;
    case 'client_approval':
      state.approvals.push({ ...e, hash: returnHash(state) });
      break;
    case 'view_sensitive':
      state.viewLog.push(e);
      break;
    case 'file':
      state.filed = { ...e, hash: returnHash(state), return: computeReturn(state) };
      break;
    default:
      break;
  }
}

/** Events undone by `revert` events. A revert of a revert restores its targets. */
function revertedSet(events, actors) {
  const reverted = new Set();
  const rejected = new Map();
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const e of events) {
    if (e.kind !== 'revert' || reverted.has(e.id)) continue;
    const role = actors.get(e.actor)?.role;
    const targets = e.payload?.batch ? events.filter((x) => x.batch === e.payload.batch && x.seq < e.seq) : [byId.get(e.target)].filter(Boolean);
    if (!targets.length) { rejected.set(e.id, 'nothing to revert'); continue; }
    if (!targets.every((t) => t.actor === e.actor) && !CAN.oversee.has(role)) {
      rejected.set(e.id, 'only the author, a reviewer or a partner can undo this');
      continue;
    }
    for (const t of targets) {
      if (t.kind === 'revert') {
        const inner = t.payload?.batch ? events.filter((x) => x.batch === t.payload.batch && x.seq < t.seq) : [byId.get(t.target)];
        for (const i of inner) reverted.delete(i.id);
      }
      reverted.add(t.id);
    }
  }
  return { reverted, rejected };
}

/**
 * Builds a reducer base from the immutable inputs. `checks` is runChecks() output for `versionId`.
 */
export function makeBase(packet, matched, checks) {
  const v = packet.index.versions.get(checks.version);
  const standards = packet.raw.firm.starter_standards;
  return {
    packet, matched, checks,
    versionId: checks.version,
    version: v,
    lines: new Map(packet.lines.filter((l) => l.version === checks.version).map((l) => [l.key, l])),
    requiredSteps: standards.required_steps,
    verificationTypes: standards.verification_types,
    partnerThreshold: Number(standards.rules.map((r) => r.match(/tax effect over ([\d,]+)/i)?.[1]).find(Boolean)?.replace(/,/g, '') ?? 1000),
  };
}

export function reduce(base, events) {
  const actors = actorsFrom(base.packet);
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const { reverted, rejected: revertRejected } = revertedSet(ordered, actors);

  const state = {
    base, actors,
    items: new Map(base.checks.results.map((r) => [r.id, { result: r, closing: null, signoffs: [] }])),
    notes: new Map(), steps: new Map(), verifications: new Map(),
    returnSignoffs: [], approvals: [], filed: null, viewLog: [],
  };
  const log = [];
  for (const e of ordered) {
    if (revertRejected.has(e.id)) { log.push({ event: e, status: 'rejected', reason: revertRejected.get(e.id) }); continue; }
    if (e.kind === 'revert') { log.push({ event: e, status: 'applied' }); continue; }
    if (reverted.has(e.id)) { log.push({ event: e, status: 'reverted' }); continue; }
    const reason = validate(state, e);
    if (reason) { log.push({ event: e, status: 'rejected', reason }); continue; }
    apply(state, e);
    log.push({ event: e, status: 'applied' });
  }

  const items = [...state.items.values()].map((i) => ({
    ...i.result, status: itemStatus(i), closing: i.closing, signoffs: i.signoffs, requiredSignoffs: requiredLevels(i),
    stale: i.signoffs.filter((s) => s.hash !== itemHash(i)).map((s) => s.id),
  }));
  const ret = computeReturn(state);
  const b = blockers(state);
  return {
    items,
    itemsById: new Map(items.map((i) => [i.id, i])),
    return: ret,
    steps: steps(state),
    notes: [...state.notes.values()],
    verifications: Object.fromEntries(state.verifications),
    returnSignoffs: state.returnSignoffs.map((s) => ({ ...s, valid: s.hash === returnHash(state) })),
    approvals: state.approvals.map((a) => ({ ...a, valid: a.hash === returnHash(state) })),
    filed: state.filed,
    viewLog: state.viewLog,
    blockers: b,
    canFile: b.length === 0,
    log,
  };
}

/** What changed between two reduced states ("since I last looked"). */
export function changesBetween(before, after) {
  const items = after.items
    .filter((i) => before.itemsById.get(i.id)?.status !== i.status)
    .map((i) => ({ id: i.id, from: before.itemsById.get(i.id)?.status ?? null, to: i.status }));
  const beforeLines = new Map(before.return.lines.map((l) => [l.key, l.effective]));
  const lines = after.return.lines.filter((l) => beforeLines.get(l.key) !== l.effective).map((l) => ({ key: l.key, from: beforeLines.get(l.key) ?? l.engine, to: l.effective }));
  const totals = {};
  for (const j of ['federal', 'california']) {
    for (const k of ['total_tax', 'payments', 'balance_due']) {
      const d = after.return.effective[j][k] - before.return.effective[j][k];
      if (d) totals[`${j}.${k}`] = d;
    }
  }
  return { items, lines, totals, newEvents: after.log.length - before.log.length };
}
