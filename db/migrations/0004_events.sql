-- Step 4: the append-only event log. The reducer (src/domain/events/reduce.js) is
-- the only interpreter of these rows; nothing else stores state. Rejected events
-- stay in the log with the reason the reducer gives.

create table memberships (
  user_id    uuid primary key references auth.users(id),
  actor_id   text not null,                 -- firm.staff[].id (st-01...) or firm.client_users[].id (cu-01...)
  packet_id  text not null references packet_raw(id)
);

create table events (
  packet_id  text not null references packet_raw(id),
  seq        bigint generated always as identity,
  id         text generated always as ('e' || seq::text) stored,
  at         timestamptz not null default now(),
  actor      text not null,
  kind       text not null check (kind in ('correct','decide','dismiss','dispose','explain','acknowledge','adjust','verify',
                                           'signoff','note','resolve_note','complete_step','client_approval','file','revert','view_sensitive')),
  target     text,
  payload    jsonb not null default '{}',
  batch      text,
  primary key (packet_id, seq)
);
create index events_target on events (packet_id, target);
create index events_batch on events (packet_id, batch) where batch is not null;

-- Append-only: no updates or deletes, ever. Undo is a 'revert' event.
create trigger events_append_only before update or delete on events
  for each row execute function forbid_packet_change();

alter table events enable row level security;
alter table memberships enable row level security;

create policy memberships_self on memberships for select to authenticated using (user_id = auth.uid());

create policy events_read on events for select to authenticated
  using (exists (select 1 from memberships m where m.user_id = auth.uid() and m.packet_id = events.packet_id));

-- A signed-in user may only write events as themselves. Role rules (who may sign
-- off what) are enforced by the reducer, which rejects violating events.
-- 'file' is excluded: only the filing-gate function (service role) inserts it,
-- after re-running the reducer and finding no blockers.
create policy events_insert_self on events for insert to authenticated
  with check (
    kind <> 'file'
    and exists (select 1 from memberships m where m.user_id = auth.uid() and m.packet_id = events.packet_id and m.actor_id = events.actor)
  );
