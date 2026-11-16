// The deterministic reducer: reduce(base, events) -> workpaper state.
// `base` is the immutable packet plus seeded facts and check results; `events` is
// the append-only log. Invalid events are kept in the log but rejected here with a
// reason, so the state never depends on anything but the log.

import { contentHash } from './hash.js';
import { actorsFrom, CAN, STANDARD_KEYS } from './people.js';

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

/** The largest tax effect an item (or any of its alternatives) can have. */
function largestEffect(r) {
  const e = r.effect ?? {};
  return Math.max(Math.abs(e.federal ?? 0), Math.abs(e.california ?? 0), Math.abs(e.federal_payments ?? 0), Math.abs(e.california_payments ?? 0),
    ...(r.alternatives ?? []).map((a) => Math.max(Math.abs(a.effect?.federal ?? 0), Math.abs(a.effect?.california ?? 0))));
}

// The partner threshold is a firm standard the administrator can change, so the
// required sign-off level is derived here rather than fixed when the check ran.
let threshold = 1000;
function requiredLevels(item) {
  return largestEffect(item.result) > threshold ? ['reviewer', 'partner'] : ['reviewer'];
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

// ---------------------------------------------------------------------------
// Line arithmetic. The engine can't be rerun, so the effective return is the engine
// return plus changes. Every recorded change becomes a per-line delta, and deltas flow
// up through each line that is a signed sum of its inputs (R-SUM, R-CARRY and the
// like, inferred from the engine's own values). Lines that are not sums (tax tables,
// limits, ratios) stop the flow; there an item's estimated tax effect is booked on the
// tax line, so the line totals always roll up to the headline figures.

const TOL = 1.5;
const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Only true sums and carries pass changes on. The engine also labels floored and
// phased-out amounts R-SUM (AMT = max(0, ...), a credit after phase-out), so forms whose
// arithmetic embeds limits never pass changes on; there the engine's what-if values or
// the item's tax effect apply instead.
const SUM_RULES = new Set(['R-SUM', 'R-CARRY', 'R-DEDUCTION-CHOICE']);
const LIMITED_FORMS = new Set(['F6251', 'F8812', 'F8863', 'F2441', 'F8960', 'F8959', 'F8995', 'F2210', 'SchSE', 'F8582', 'F7203', 'F8606', 'F8889']);
const LIMITED_LABEL = /minimum tax|phase-?out|limit|allowed|excess/i;

/** Signs that make a line the sum of its inputs, or null when it isn't one. */
function sumSigns(line, lines) {
  if (!SUM_RULES.has(line.rule) || LIMITED_FORMS.has(line.form) || LIMITED_LABEL.test(line.label)) return null;
  const vals = line.inputs.map((k) => lines.get(k)?.value);
  if (!line.inputs.length || typeof line.value !== 'number' || vals.some((v) => typeof v !== 'number')) return null;
  const n = vals.length;
  const fits = (signs) => Math.abs(vals.reduce((t, v, i) => t + signs[i] * v, 0) - line.value) <= TOL;
  const plus = vals.map(() => 1);
  if (fits(plus)) return plus;
  if (n > 14) return null;
  // Fewest minus signs first, so an input whose engine value is 0 is taken as added.
  const masks = [...Array(2 ** n).keys()].sort((a, b) => popcount(a) - popcount(b) || a - b);
  for (const m of masks) {
    const signs = vals.map((_, i) => ((m >> i) & 1 ? -1 : 1));
    if (fits(signs)) return signs;
  }
  return null;
}
const popcount = (m) => { let c = 0; for (let x = m; x; x >>= 1) c += x & 1; return c; };

export function lineGraph(lines) {
  const signs = new Map();
  for (const l of lines.values()) signs.set(l.key, sumSigns(l, lines));
  const order = [];
  const seen = new Set();
  const visit = (k) => {
    if (seen.has(k) || !lines.has(k)) return;
    seen.add(k);
    for (const i of lines.get(k).inputs) visit(i);
    order.push(k);
  };
  for (const k of lines.keys()) visit(k);
  return { signs, order };
}

/**
 * Deltas for every line. `set` deltas replace what the inputs would give (the engine's
 * what-if, consistent in itself); `add` deltas are changes recorded on the line itself
 * and come on top of whatever flows in from its inputs.
 */
function propagate(base, set, add) {
  const { signs, order } = base.graph;
  const d = new Map();
  for (const k of order) {
    let v = 0;
    if (set.has(k)) v = set.get(k);
    else {
      const sg = signs.get(k);
      if (sg) base.lines.get(k).inputs.forEach((i, n) => { v += sg[n] * (d.get(i) ?? 0); });
      v += add.get(k) ?? 0;
    }
    if (Math.abs(v) >= 1e-9) d.set(k, round6(v));
  }
  return d;
}

// Where each part of an item's effect must show, and the line it is booked on when the
// line arithmetic alone doesn't carry it there.
const HEADLINES = [
  ['F1040.24', 'federal', 'F1040.16'], ['F540NR.64', 'california', 'F540NR.37'],
  ['F1040.33', 'federal_payments', 'F1040.26'], ['F540NR.78', 'california_payments', 'F540NR.72'],
];

/** The per-line deltas one closing event contributes, and the part recorded on each line itself. */
function closingDeltas(base, item) {
  const c = item.closing;
  const r = item.result;
  const set = new Map();
  const add = new Map();
  const engine = (k) => base.lines.get(k)?.value ?? 0;
  const put = (m, k, v) => { if (base.lines.has(k)) m.set(k, (m.get(k) ?? 0) + v); };
  const key0 = r.lines[0]?.split('|')[1];
  // A correction moves the line by the difference the check found (its engine figure vs
  // the expected one), which is the whole line only when the check is about the line.
  if (c.kind === 'correct' && typeof r.expected === 'number' && key0) put(add, key0, r.expected - (typeof r.engine === 'number' ? r.engine : engine(key0)));
  if (c.kind === 'adjust') { const k = c.target.slice('line:'.length); put(add, k, c.payload.value - engine(k)); }
  if (c.kind === 'decide') {
    const alt = r.alternatives[c.payload.alternative];
    const whatIf = alt?.what_if && base.packet.raw.what_if.alternatives.find((w) => w.id === alt.what_if);
    // The engine's what-if is taken line for line (it knows floors and limits that look
    // like sums); as deltas, it adds to every other item's changes on the same lines.
    for (const ch of whatIf?.changed_lines ?? []) if (typeof ch.new === 'number') put(set, ch.key, ch.new - engine(ch.key));
    const pay = alt?.effect?.federal_payments ?? alt?.effect?.california_payments;
    if (pay && key0) put(add, key0, pay);
  }
  let d = propagate(base, set, add);
  const effect = closingEffect(item) ?? {};
  let again = false;
  for (const [head, part, root] of HEADLINES) {
    const resid = round2((effect[part] ?? 0) - (d.get(head) ?? 0));
    if (Math.abs(resid) >= 0.005) { put(add, root, resid); again = true; }
  }
  if (again) d = propagate(base, set, add);
  return { d, own: add };
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

  // Line values: engine value plus the deltas of every closing event, summed.
  const total = new Map();
  const own = new Map();
  const by = new Map();
  for (const item of items) {
    if (!item.closing) continue;
    const res = closingDeltas(base, item);
    for (const [k, v] of res.d) {
      total.set(k, (total.get(k) ?? 0) + v);
      by.set(k, [...(by.get(k) ?? []), item.closing.id]);
    }
    for (const [k, v] of res.own) own.set(k, (own.get(k) ?? 0) + v);
  }
  const lines = [...total].filter(([, v]) => Math.abs(v) >= 1e-6).map(([key, v]) => {
    const engine = base.lines.get(key).value;
    const ratio = Math.abs(engine) < 1 && !Number.isInteger(engine);
    return { key, engine, effective: ratio ? Math.round((engine + v) * 1e4) / 1e4 : round2(engine + v), own: round2(own.get(key) ?? 0), events: by.get(key) };
  });
  return {
    engine: { federal: s.federal, california: s.california },
    effective: { federal, california },
    delta,
    lines: lines.sort((a, b) => (a.key < b.key ? -1 : 1)),
    method: 'Engine values plus recorded changes. Changes flow up through every line that is a sum of its inputs; where the engine computed tax (not a sum), each item\'s estimated effect (tax_effect_rates or what_if) is booked on the tax line, so the lines add up to the totals. The engine is not rerun.',
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
  for (const q of state.questions.values()) if (q.payload.blocking && !q.answer) out.push({ type: 'question', id: q.id, text: q.payload.text });
  for (const s of steps(state)) if (!s.done) out.push({ type: 'step', id: s.name });
  if (state.filed && !state.amendment) out.push({ type: 'frozen', id: state.filed.id });
  return out;
}

// ---------------------------------------------------------------------------
// Validation: returns a reason string when the event must be rejected.

function validate(state, e) {
  const actor = state.actors.get(e.actor);
  if (!actor) return 'unknown actor';
  if (actor.active_from && e.at.slice(0, 10) < actor.active_from) return `${actor.name} is not active until ${actor.active_from}`;
  const role = actor.role;
  if (state.filed && !state.amendment && CONTENT_KINDS.has(e.kind)) return 'the return is filed and frozen; changes go on an amendment';
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
    case 'extend':
      if (!CAN.file.has(role)) return `${role} cannot file an extension`;
      if (state.filings.length) return 'the return is already filed';
      if (!['federal', 'california'].includes(e.payload?.jurisdiction)) return 'say which jurisdiction (federal or california)';
      if (typeof e.payload?.payment !== 'number' || e.payload.payment < 0) return 'record the payment sent with the extension (0 if none)';
      if (state.extensions.some((x) => x.payload.jurisdiction === e.payload.jurisdiction)) return `a ${e.payload.jurisdiction} extension is already on file`;
      return null;
    case 'efile_ack': {
      if (!CAN.file.has(role)) return `${role} cannot record e-file acknowledgements`;
      const last = state.filings.at(-1);
      if (!last || !state.filed) return 'nothing has been transmitted';
      if (!['federal', 'california'].includes(e.payload?.jurisdiction)) return 'say which jurisdiction (federal or california)';
      if (!['accepted', 'rejected'].includes(e.payload?.status)) return 'status is accepted or rejected';
      if (e.payload.status === 'rejected' && !e.payload.code) return 'a rejection records the agency\'s error code';
      if (last.acks.some((a) => a.payload.jurisdiction === e.payload.jurisdiction)) return `the ${e.payload.jurisdiction} acknowledgement for this submission is already recorded`;
      return null;
    }
    case 'amend':
      if (!CAN.file.has(role)) return `${role} cannot open an amendment`;
      if (!state.filed) return 'only a filed return can be amended';
      if (state.amendment) return 'an amendment is already open';
      if (!state.filed.acks.some((a) => a.payload.status === 'accepted')) return 'wait until an agency accepts the filed return';
      if (!e.payload?.reason) return 'an amendment records why';
      return null;
    case 'ask': {
      if (actor.kind === 'staff' && !CAN.note.has(role)) return `${role} cannot ask questions`;
      const to = state.actors.get(e.payload?.to);
      if (!to) return 'address the question to a colleague or the client';
      if (to.id === e.actor) return 'you cannot ask yourself';
      if (actor.kind === 'client' && to.kind === 'client') return 'clients ask the firm, not each other';
      if (!e.payload?.text) return 'a question needs text';
      return null;
    }
    case 'answer': {
      const q = state.questions.get(e.target);
      if (!q) return `no question ${e.target}`;
      if (q.answer) return 'already answered';
      const to = state.actors.get(q.payload.to);
      const mine = q.payload.to === e.actor || (to.kind === 'client' && actor.kind === 'client');
      if (!mine) return `only ${to.name} can answer this`;
      if (!e.payload?.text) return 'an answer needs text';
      return null;
    }
    case 'assign': {
      if (!CAN.assign.has(role)) return `${role} cannot assign work`;
      const to = state.actors.get(e.payload?.to);
      if (!to || to.kind !== 'staff' || !CAN.prepare.has(to.role)) return 'assign to a preparer, reviewer or partner';
      if (to.active_from && e.at.slice(0, 10) < to.active_from) return `${to.name} is not active until ${to.active_from}`;
      if (!e.target) return 'say what is being assigned';
      return null;
    }
    case 'log_time':
      if (actor.kind !== 'staff') return 'only staff log time';
      if (!(e.payload?.area in state.base.budget)) return `area must be one of: ${Object.keys(state.base.budget).join(', ')}`;
      if (!(e.payload.hours > 0 && e.payload.hours <= 24)) return 'hours must be between 0 and 24';
      return null;
    case 'set_standard':
      if (!CAN.admin.has(role)) return 'only the firm administrator changes firm standards';
      if (!STANDARD_KEYS.includes(e.target)) return `standard must be one of: ${STANDARD_KEYS.join(', ')}`;
      if (!(typeof e.payload?.value === 'number' && e.payload.value > 0)) return 'a standard needs a positive number';
      if (!e.payload.reason) return 'say why the standard changes';
      return null;
    case 'notice_response':
      if (!CAN.prepare.has(role)) return `${role} cannot answer notices`;
      if (!state.filed) return 'only a filed return has notices to answer';
      if (!state.base.packet.raw.tax_agency_records.notices.some((n) => n.id === e.target)) return `no notice ${e.target}`;
      if (!e.payload?.text) return 'a response needs text';
      return null;
    case 'roll_forward':
      if (!CAN.prepare.has(role)) return `${role} cannot roll the file forward`;
      if (!state.filed) return 'roll forward after filing';
      if (state.rolledForward) return 'already rolled forward';
      return null;
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
    case 'file': {
      const filing = { ...e, type: state.amendment ? 'amended' : 'original', amendment: state.amendment, hash: returnHash(state), return: computeReturn(state), acks: [] };
      state.filings.push(filing);
      state.filed = filing;
      state.amendment = null;
      break;
    }
    case 'extend':
      state.extensions.push(e);
      break;
    case 'efile_ack': {
      const filing = state.filed;
      filing.acks.push(e);
      if (e.payload.status === 'rejected') {
        // A rejected submission was never filed: unfreeze so it can be fixed and sent again.
        filing.rejected = e;
        state.amendment = filing.amendment;
        state.filed = [...state.filings].reverse().find((f) => !f.rejected) ?? null;
      }
      break;
    }
    case 'amend':
      state.amendment = e;
      break;
    case 'ask':
      state.questions.set(e.id, { ...e, answer: null });
      break;
    case 'answer':
      state.questions.get(e.target).answer = e;
      break;
    case 'assign':
      state.assignments.set(e.target, e);
      break;
    case 'log_time':
      state.time.push(e);
      break;
    case 'set_standard':
      state.standards[e.target] = e.payload.value;
      if (e.target === 'partner_threshold') threshold = e.payload.value;
      break;
    case 'notice_response':
      state.noticeResponses.push({ ...e, filedHash: state.filed.hash });
      break;
    case 'roll_forward':
      state.rolledForward = e;
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
    get graph() { const g = lineGraph(this.lines); Object.defineProperty(this, 'graph', { value: g }); return g; },
    requiredSteps: standards.required_steps,
    verificationTypes: standards.verification_types,
    partnerThreshold: Number(standards.rules.map((r) => r.match(/tax effect over ([\d,]+)/i)?.[1]).find(Boolean)?.replace(/,/g, '') ?? 1000),
    variance: standards.variance_review,
    budget: packet.raw.firm.budget_hours,
  };
}

export function reduce(base, events) {
  const actors = actorsFrom(base.packet);
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const { reverted, rejected: revertRejected } = revertedSet(ordered, actors);

  threshold = base.partnerThreshold;
  const state = {
    base, actors,
    items: new Map(base.checks.results.map((r) => [r.id, { result: r, closing: null, signoffs: [] }])),
    notes: new Map(), steps: new Map(), verifications: new Map(),
    returnSignoffs: [], approvals: [], filed: null, viewLog: [],
    filings: [], extensions: [], amendment: null, questions: new Map(), assignments: new Map(), time: [], noticeResponses: [], rolledForward: null,
    standards: { partner_threshold: base.partnerThreshold, variance_percent: base.variance?.flag_if_change_over_percent ?? 10, variance_amount: base.variance?.and_over_amount ?? 1000 },
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
    ...i.result, requires: { ...i.result.requires, signoff: requiredLevels(i).includes('partner') ? 'partner' : 'reviewer' },
    status: itemStatus(i), closing: i.closing, signoffs: i.signoffs, requiredSignoffs: requiredLevels(i), assignment: state.assignments.get(i.result.id) ?? null,
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
    filings: state.filings,
    extensions: state.extensions,
    amendment: state.amendment,
    questions: [...state.questions.values()],
    assignments: Object.fromEntries(state.assignments),
    time: state.time,
    standards: state.standards,
    noticeResponses: state.noticeResponses,
    rolledForward: state.rolledForward,
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
