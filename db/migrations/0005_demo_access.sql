-- Step 5: open the shared log for the hosted demo.
--
-- The app has no sign-in screen; the person switcher chooses who is acting. So
-- for a seeded packet the anon key may read and append events. Nothing else
-- changes: the log stays append-only (trigger from 0004), and the reducer still
-- rejects any event the acting person's role does not allow, keeping it in the
-- log with the reason. Drop these two policies to go back to members only.

-- Event kinds added with filing and after, people and firm.
alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check check (kind in (
  'correct','decide','dismiss','dispose','explain','acknowledge','adjust','verify',
  'signoff','note','resolve_note','complete_step','client_approval','file','revert','view_sensitive',
  'extend','efile_ack','amend','ask','answer','assign','log_time','set_standard','notice_response','roll_forward'
));

-- Actors are the packet's people (firm.staff, firm.client_users), never free text.
alter table events add constraint events_actor_shape check (actor ~ '^(st|cu)-[0-9]{2}$');

create policy events_demo_read on events for select to anon
  using (exists (select 1 from packet_raw p where p.id = events.packet_id));

-- 'file' is allowed here because there is no filing-gate function in the demo;
-- the reducer refuses a filing while any blocker is open.
create policy events_demo_insert on events for insert to anon
  with check (exists (select 1 from packet_raw p where p.id = events.packet_id));

-- Live updates: every open workpaper hears new events.
alter publication supabase_realtime add table events;
