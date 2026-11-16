// Display formatting and shared vocabulary.

const n0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const n2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n) => (typeof n === 'number' ? `${n < 0 ? '−' : ''}$${n0.format(Math.abs(n))}` : n ?? '—');
export const money2 = (n) => (typeof n === 'number' ? `${n < 0 ? '−' : ''}$${n2.format(Math.abs(n))}` : n ?? '—');
export const amount2 = (n) => (typeof n === 'number' ? `${n < 0 ? '−' : ''}${n2.format(Math.abs(n))}` : n ?? '');
export const signed = (n) => (n > 0 ? `+$${n0.format(n)}` : n < 0 ? `−$${n0.format(-n)}` : '—');
export const plain = (n) => (typeof n === 'number' ? n0.format(n) : n);

/** A return line value: dollars for money lines, as-is otherwise (dates, text, ratios, miles). */
export function lineValue(v, key = '') {
  if (typeof v !== 'number') return v ?? '—';
  if (key.startsWith('F8949.') && !key.endsWith('.total')) return money2(v);
  if (/\.(44a|44b|44c)$/.test(key)) return `${n0.format(v)} mi`;
  if (Math.abs(v) < 1 && v !== 0 && !Number.isInteger(v)) return v.toString();
  return money(v);
}

export const balance = (n) => (n < 0 ? { label: 'Refund', amount: money(-n) } : { label: 'Balance due', amount: money(n) });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const usDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : iso);

export const KIND = {
  error: { label: 'Error', color: 'var(--red)', help: 'The evidence establishes that the return is wrong. Closed by a correction.' },
  conflict: { label: 'Conflict', color: '#ea8c16', help: 'Sources disagree or a value is missing. Someone decides what to rely on.' },
  judgment: { label: 'Judgment', color: 'var(--primary)', help: 'More than one treatment is defensible. Decide and cite the authority.' },
  completeness: { label: 'To account for', color: 'var(--gray-dot)', help: 'Explain or dispose of it before filing.' },
  outside_filing: { label: 'Outside filing', color: 'var(--teal)', help: 'An obligation beyond this return that the records imply.' },
  adjustment: { label: 'Adjustment', color: '#71717a', help: 'A change entered by hand, with its reason and effect.' },
};
export const KIND_ORDER = ['error', 'conflict', 'judgment', 'adjustment', 'completeness', 'outside_filing'];

export const STATUS = {
  open: { label: 'Open', tone: 'gray' },
  awaiting_signoff: { label: 'Awaiting sign-off', tone: 'amber' },
  reopened: { label: 'Reopened', tone: 'red' },
  closed: { label: 'Closed', tone: 'green' },
};

export const ROLE_COLOR = {
  preparer: '#4449e0', reviewer: '#0f766e', partner: '#27272a', firm_administrator: '#a16207', quality_reviewer: '#7c3aed', client: '#c2410c',
};
export const ROLE_LABEL = {
  preparer: 'Preparer', reviewer: 'Reviewer', partner: 'Partner', firm_administrator: 'Firm admin', quality_reviewer: 'Quality reviewer', client: 'Client',
};
export const initials = (name = '') => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export const ACTION_WORDS = {
  correct: 'Applied correction', decide: 'Recorded decision', dismiss: 'Dismissed finding', dispose: 'Recorded disposition',
  explain: 'Explained variance', acknowledge: 'Acknowledged', adjust: 'Adjusted line', verify: 'Verified', signoff: 'Signed off',
  note: 'Added note', resolve_note: 'Resolved note', complete_step: 'Completed step', client_approval: 'Approved return',
  file: 'Filed return', revert: 'Undid', view_sensitive: 'Viewed unmasked data',
  extend: 'Filed extension', efile_ack: 'Recorded e-file result', amend: 'Opened amendment', ask: 'Asked a question', answer: 'Answered',
  assign: 'Assigned', log_time: 'Logged time', set_standard: 'Changed firm standard', notice_response: 'Answered notice', roll_forward: 'Rolled forward to 2026',
};

export const maskSsn = (v) => String(v).replace(/^\d{3}-\d{2}/, '•••-••');
