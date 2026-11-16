// The workpaper context: who is acting, the event log, the reduced state, and the
// few UI-wide affordances (toasts, the trace drawer, "since you last looked").

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { reduce, append, changesBetween } from '../../domain/events/index.js';
import { base, packet, actorById } from './base.js';
import { openStore } from './store.js';
import { packetId } from '../../db/rows.js';
import { useRoute } from './router.js';

const Ctx = createContext(null);
const ACTOR_KEY = 'miraflores.workpaper.actor';
const SEEN_KEY = 'miraflores.workpaper.seen';
const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export function WorkpaperProvider({ children }) {
  const [store, setStore] = useState(null);
  const [events, setEvents] = useState([]);
  const [actorId, setActorId] = useState(() => read(ACTOR_KEY, 'st-01'));
  const [toasts, setToasts] = useState([]);
  const [trace, setTrace] = useState(null);
  const [seen, setSeen] = useState(() => read(SEEN_KEY, {}));
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    let unsub = () => {};
    openStore(packetId(packet)).then(async (s) => {
      setStore(s);
      setEvents(await s.load());
      unsub = s.subscribe(async () => setEvents(await s.load()));
    });
    return () => unsub();
  }, []);

  const state = useMemo(() => reduce(base, events), [events]);
  const actor = actorById.get(actorId);
  const presence = usePresence(actorId);

  const toast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((xs) => [...xs, { id, ...t }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.ms ?? 6000);
  }, []);

  /** Appends events as the current actor. Shows the reducer's verdict; offers undo. */
  const dispatch = useCallback(async (drafts, { label, undoable = true } = {}) => {
    const list = Array.isArray(drafts) ? drafts : [drafts];
    const batch = list.length > 1 ? `b-${Date.now().toString(36)}` : undefined;
    const now = new Date().toISOString();
    const prev = eventsRef.current;
    const next = append(prev, ...list.map((d) => ({ actor: actorId, at: now, batch, ...d })));
    const added = next.slice(prev.length);
    const saved = await store.append(next, added);
    setEvents(saved);
    const reduced = reduce(base, saved);
    const verdicts = reduced.log.slice(-list.length); // the log is in seq order; ours are the newest
    const rejected = verdicts.filter((v) => v.status === 'rejected');
    if (rejected.length) {
      toast({ kind: 'warn', text: rejected.length === list.length ? rejected[0].reason : `${list.length - rejected.length} applied, ${rejected.length} not allowed: ${rejected[0].reason}`, ms: 8000 });
    } else if (label) {
      const undo = undoable ? () => dispatch(batch ? { kind: 'revert', payload: { batch } } : { kind: 'revert', target: added[0].id }, { label: 'Undone', undoable: false }) : null;
      toast({ kind: 'ok', text: label, action: undo && { label: 'Undo', run: undo } });
    }
    return { rejected, added };
  }, [actorId, store, toast]);

  const switchActor = (id) => { setActorId(id); write(ACTOR_KEY, id); };

  const lastSeenSeq = seen[actorId] ?? 0;
  const sinceLastSeen = useMemo(() => {
    const before = reduce(base, events.filter((e) => e.seq <= lastSeenSeq));
    return { ...changesBetween(before, state), events: events.filter((e) => e.seq > lastSeenSeq) };
  }, [events, state, lastSeenSeq]);
  const markSeen = () => {
    const next = { ...seen, [actorId]: events.length ? Math.max(...events.map((e) => e.seq)) : 0 };
    setSeen(next);
    write(SEEN_KEY, next);
  };

  const resetDemo = async () => { await store.reset(); setEvents([]); toast({ kind: 'ok', text: 'Workpaper reset to the engine output' }); };

  const value = {
    ready: Boolean(store), store, events, state, actor, actorId, switchActor, dispatch, toast, toasts,
    trace, openTrace: (t) => setTrace({ ...t, id: Date.now() }), closeTrace: () => setTrace(null), sinceLastSeen, markSeen, resetDemo,
    canSeeSensitive: Boolean(actor?.sensitive_data_clearance), presence,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useWorkpaper = () => useContext(Ctx);

// Presence: who else has the workpaper open, and on which screen. Tabs of this
// browser talk over a BroadcastChannel (Supabase Realtime presence plays the same
// role for a shared log). Presence is not part of the record, so it is never an event.
const TAB = Math.random().toString(36).slice(2);
function usePresence(actorId) {
  const { path, params } = useRoute();
  const where = `${path}${params.id ? `:${params.id}` : params.line ? `:${params.line}` : ''}`;
  const [peers, setPeers] = useState({});
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel('miraflores.presence');
    const me = () => ({ tab: TAB, actorId, path, where, at: Date.now() });
    const beat = () => ch.postMessage(me());
    ch.onmessage = (m) => {
      const p = m.data;
      if (p.tab === TAB) return;
      if (p.bye) setPeers((x) => { const n = { ...x }; delete n[p.tab]; return n; });
      else { setPeers((x) => ({ ...x, [p.tab]: p })); if (p.hello) beat(); }
    };
    ch.postMessage({ ...me(), hello: true });
    const timer = setInterval(() => { beat(); setPeers((x) => Object.fromEntries(Object.entries(x).filter(([, p]) => Date.now() - p.at < 12000))); }, 4000);
    const bye = () => ch.postMessage({ tab: TAB, bye: true });
    window.addEventListener('beforeunload', bye);
    return () => { bye(); clearInterval(timer); window.removeEventListener('beforeunload', bye); ch.close(); };
  }, [actorId, path, where]);
  return Object.values(peers);
}
