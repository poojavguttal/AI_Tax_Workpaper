// Who may act, from the firm's staff list and client users in the packet. The role
// comes from the staff record, never from the event, so it cannot be claimed.

export function actorsFrom(packet) {
  const staff = packet.raw.firm.staff.map((s) => ({ ...s, kind: 'staff' }));
  const clients = packet.raw.firm.client_users.map((c) => ({ ...c, kind: 'client', active_from: null, sensitive_data_clearance: false }));
  return new Map([...staff, ...clients].map((a) => [a.id, a]));
}

export const CAN = {
  prepare: new Set(['preparer', 'reviewer', 'partner']),      // correct, decide, dispose, explain, adjust, verify, complete steps
  signoff: { reviewer: new Set(['reviewer', 'partner']), partner: new Set(['partner']) },
  note: new Set(['preparer', 'reviewer', 'partner', 'quality_reviewer', 'firm_administrator']),
  oversee: new Set(['reviewer', 'partner']),                   // revert others' events, resolve others' notes
  file: new Set(['reviewer', 'partner']),
  approve: new Set(['client']),
};
