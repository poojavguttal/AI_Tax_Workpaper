-- Step 2: activities, facts and how observations attach to them, plus document
-- relations and dispositions. Seeded by the matcher (by = 'system'); people will
-- confirm, split or merge through events (step 4), never by editing these rows.

create table activities (
  packet_id  text not null references packet_raw(id),
  id         text not null,                 -- 'rental:fremont', 'investments:meridian', ...
  name       text not null,
  primary key (packet_id, id)
);

create table facts (
  packet_id          text not null,
  id                 text not null,         -- 'D28#3:N1', 'person:theo.ssn', 'payment:federal:2026-01-15'
  kind               text not null,         -- value | record | lot | identity | payment | statement | agency_record | prior_year
  activity_id        text not null,
  name               text,
  label              text,
  home_doc_id        text,
  home_page          int,
  status             text not null,         -- single | corroborated | incomplete | conflict
  fields             jsonb not null,        -- resolved value per field
  conflicts          jsonb not null,
  superseded_changes jsonb not null,
  component_checks   jsonb not null,
  primary key (packet_id, id),
  foreign key (packet_id, activity_id) references activities(packet_id, id)
);
create index facts_activity on facts (packet_id, activity_id);
create index facts_status on facts (packet_id, status);

create table fact_observations (
  packet_id       text not null,
  fact_id         text not null,
  observation_id  text not null,
  role            text not null check (role in ('primary','duplicate','superseded','supporting','part','component','included_in')),
  field           text not null,
  value           jsonb,                     -- may differ from the observation (e.g. an amount parsed from a client answer)
  primary key (packet_id, observation_id),   -- every observation sits in exactly one fact
  foreign key (packet_id, fact_id) references facts(packet_id, id),
  foreign key (packet_id, observation_id) references observations(packet_id, id)
);

create table fact_merges (
  packet_id  text not null,
  seq        int not null,
  into_fact  text not null,
  from_fact  text not null,
  role       text not null,
  rule       text not null,
  why        text not null,
  primary key (packet_id, seq)
);

create table document_relations (
  packet_id  text not null,
  seq        int not null,
  kind       text not null,                 -- duplicate_document | supersedes | duplicate_page | same_fact | components | included_in
  doc_id     text not null,
  of_doc_id  text not null,
  detail     jsonb,                         -- page numbers, changed fields, account, evidence page
  rule       text not null,
  primary key (packet_id, seq)
);

create table document_dispositions (
  packet_id  text not null,
  doc_id     text not null,
  kind       text not null,
  reason     text,
  by         text not null,                 -- 'system' at seed; later dispositions are events
  primary key (packet_id, doc_id)
);

do $$
declare t text;
begin
  foreach t in array array['activities','facts','fact_observations','fact_merges','document_relations','document_dispositions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format('create trigger %I before update or delete on %I for each row execute function forbid_packet_change()',
                   t || '_immutable', t);
  end loop;
end $$;
