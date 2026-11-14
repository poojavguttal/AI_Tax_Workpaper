// Loads data/packet.json into Supabase. Refuses to seed a packet that fails integrity.
//   npm run seed:dry                         -> validate and print row counts, no network
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadPacket, checkIntegrity } from '../src/domain/packet/index.js';
import { matchFacts } from '../src/domain/facts/index.js';
import { runChecks } from '../src/domain/checks/index.js';
import { toRows, toFactRows, toCheckRows, PACKET_TABLES, FACT_TABLES, packetId } from '../src/db/rows.js';

const dryRun = process.argv.includes('--dry-run');
const text = readFileSync(new URL('../data/packet.json', import.meta.url), 'utf8');
const sha256 = createHash('sha256').update(text).digest('hex');
const packet = loadPacket(JSON.parse(text));

const problems = checkIntegrity(packet);
if (problems.length) {
  console.error(`Packet failed integrity (${problems.length} problems):`, problems.slice(0, 10));
  process.exit(1);
}

const matched = matchFacts(packet);
const rows = { ...toRows(packet, { sha256 }), ...toFactRows(packet, matched), ...toCheckRows(packet, runChecks(packet, matched)) };
const TABLES = [...PACKET_TABLES, ...FACT_TABLES, 'check_results'];
console.log(`Packet ${packetId(packet)} sha256 ${sha256.slice(0, 12)}…`);
for (const t of TABLES) console.log(`  ${t.padEnd(22)} ${rows[t].length}`);
if (dryRun) process.exit(0);

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run with --dry-run.');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: existing } = await db.from('packet_raw').select('sha256').eq('id', packetId(packet)).maybeSingle();
if (existing) {
  if (existing.sha256 !== sha256) {
    console.error('A different packet with this id is already loaded; packet tables are immutable.');
    process.exit(1);
  }
  console.log('Already loaded; nothing to do.');
  process.exit(0);
}

for (const t of TABLES) {
  for (let i = 0; i < rows[t].length; i += 500) {
    const { error } = await db.from(t).insert(rows[t].slice(i, i + 500));
    if (error) {
      console.error(`Insert into ${t} failed:`, error.message);
      process.exit(1);
    }
  }
  console.log(`  loaded ${t}`);
}
console.log('Done.');
