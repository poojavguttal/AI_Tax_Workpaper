// Helpers for building events. The log is append-only: `append` returns a new array.

let fallbackClock = 0;

/** Appends events, assigning seq and id. `at` should come from the caller's clock. */
export function append(log, ...drafts) {
  let seq = log.length ? Math.max(...log.map((e) => e.seq)) : 0;
  const added = drafts.map((d) => {
    seq += 1;
    return { id: `e${seq}`, seq, at: d.at ?? new Date(Date.UTC(2026, 2, 1) + (fallbackClock++) * 60_000).toISOString(), payload: {}, ...d };
  });
  return [...log, ...added];
}

/** The closing event an item's kind requires, filled from the check result. */
export function closeWith(item, { actor, at, batch, alternative, rationale, authority, reason }) {
  const action = item.requires.action;
  const kind = { correction: 'correct', decision: 'decide', disposition: 'dispose', explanation: 'explain', acknowledgement: 'acknowledge' }[action];
  const payload = kind === 'decide'
    ? { alternative, rationale, ...(authority ? { authority } : {}) }
    : kind === 'correct' ? { reason: reason ?? item.title }
      : kind === 'explain' ? { explanation: reason }
        : kind === 'acknowledge' ? { note: reason } : { reason };
  return { kind, actor, at, batch, target: item.id, payload };
}

/** The alternative the check recommends (null when it recommends gathering more evidence). */
export const recommendedAlternative = (item) => item.recommendation?.alternative ?? null;
