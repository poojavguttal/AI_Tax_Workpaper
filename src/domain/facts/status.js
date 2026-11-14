// Assesses a fact from its members: the resolved value of each field, and whether
// the observations agree. Confidence scores play no part; only values do.

const COMPARED = new Set(['primary', 'duplicate', 'supporting', 'part']);
const PREFERENCE = ['primary', 'part', 'duplicate', 'supporting'];
const DOC_KINDS = new Set(['value', 'record', 'lot']);

const missing = (v) => v === null || v === undefined || v === '';

export function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005;
  return String(a).trim() === String(b).trim();
}

export function assess(fact) {
  const byField = new Map();
  for (const m of fact.members) {
    if (!byField.has(m.field)) byField.set(m.field, []);
    byField.get(m.field).push(m);
  }

  const fields = {};
  const conflicts = [];
  const supersededChanges = [];
  const componentChecks = [];
  const incomplete = [];

  for (const [field, members] of byField) {
    const compared = members.filter((m) => COMPARED.has(m.role) && !missing(m.value));
    const preferred = PREFERENCE.map((r) => members.find((m) => m.role === r && !missing(m.value))).find(Boolean);
    fields[field] = preferred ? preferred.value : null;
    // A blank on a document is a gap (e.g. a lot with no cost basis); a null in a
    // structured record (an asset not disposed) is just "none".
    if (!preferred && DOC_KINDS.has(fact.kind) && members.some((m) => COMPARED.has(m.role))) incomplete.push(field);

    if (compared.some((m) => !sameValue(m.value, compared[0].value))) {
      conflicts.push({ field, values: compared.map((m) => ({ obs: m.obs, role: m.role, value: m.value })) });
    }
    for (const m of members.filter((x) => x.role === 'superseded')) {
      if (!sameValue(m.value, fields[field])) supersededChanges.push({ field, obs: m.obs, from: m.value, to: fields[field] });
    }
    const components = members.filter((m) => m.role === 'component');
    if (components.length) {
      const sum = components.reduce((s, m) => s + Number(m.value), 0);
      const ok = sameValue(sum, Number(fields[field]));
      componentChecks.push({ field, sum, total: fields[field], ok });
      if (!ok) conflicts.push({ field, values: [{ obs: null, role: 'component_sum', value: sum }, { obs: null, role: 'total', value: fields[field] }] });
    }
  }

  const sources = new Set(fact.members.map((m) => m.obs));
  const status = conflicts.length ? 'conflict'
    : incomplete.length ? 'incomplete'
      : fact.members.some((m) => m.role !== 'primary' && m.role !== 'part') ? 'corroborated'
        : 'single';

  const fieldNames = Object.keys(fields);
  return {
    status,
    value: fieldNames.length === 1 ? fields[fieldNames[0]] : fields,
    fields,
    conflicts,
    supersededChanges,
    componentChecks,
    incomplete,
    observationCount: sources.size,
  };
}
