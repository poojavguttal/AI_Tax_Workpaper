// Event persistence. LocalStore keeps the log in this browser; SupabaseStore uses
// the events table (0004_events.sql) and Realtime when VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY are set. Both are append-only.

const KEY = 'miraflores.workpaper.events.v1';

export class LocalStore {
  constructor() { this.kind = 'local'; }
  async load() {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  }
  async append(log) {
    try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* storage unavailable: session only */ }
    return log;
  }
  async reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
  subscribe() { return () => {}; }
}

export class SupabaseStore {
  constructor(client, packetId) { this.kind = 'supabase'; this.db = client; this.packetId = packetId; }
  async load() {
    const { data, error } = await this.db.from('events').select('*').eq('packet_id', this.packetId).order('seq');
    if (error) throw error;
    return data;
  }
  /** Inserts only the drafts not yet stored; the database assigns seq and id. */
  async append(log, added) {
    const rows = added.map(({ kind, actor, target, payload, batch, at }) => ({ packet_id: this.packetId, kind, actor, target, payload, batch, at }));
    const { error } = await this.db.from('events').insert(rows);
    if (error) throw error;
    return this.load();
  }
  async reset() { throw new Error('The shared log is append-only.'); }
  subscribe(onChange) {
    const ch = this.db.channel('events').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `packet_id=eq.${this.packetId}` }, onChange).subscribe();
    return () => this.db.removeChannel(ch);
  }
}

export async function openStore(packetId) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    const { createClient } = await import('@supabase/supabase-js');
    return new SupabaseStore(createClient(url, key), packetId);
  }
  return new LocalStore();
}
