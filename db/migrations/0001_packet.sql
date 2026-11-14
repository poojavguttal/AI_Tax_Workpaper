-- Step 1: packet tables. Loaded once by scripts/seed.js with the service role,
-- then read-only for everyone. Workpaper tables (facts, events, checks) come in later migrations.

create table packet_raw (
  id          text primary key,            -- packet.client_id + version, e.g. 'CL-20417@1.0'
  json        jsonb not null,              -- the packet exactly as delivered
  sha256      text not null,
  loaded_at   timestamptz not null default now()
);

create table documents (
  packet_id          text not null references packet_raw(id),
  id                 text not null,         -- D01..D74
  title              text not null,
  document_type      text not null,
  issuer             text,
  belongs_to         text not null,
  tax_year           int,
  received_at        timestamptz,
  uploaded_by        text,
  file_name          text,
  page_count         int not null,
  marked_corrected   boolean not null default false,
  extraction_status  text not null,         -- extracted | partial | not_extracted
  extraction_reason  text,
  primary key (packet_id, id)
);

create table pages (
  packet_id        text not null,
  doc_id           text not null,
  page             int not null,
  printed_content  text not null,
  render_kind      text not null default 'simulated',  -- simulated | image | pdf
  asset_url        text,                                -- a real scan replaces the simulation here
  primary key (packet_id, doc_id, page),
  foreign key (packet_id, doc_id) references documents(packet_id, id)
);

create table observations (
  packet_id       text not null,
  id              text not null,             -- the packet's own ref: ev-0538, qa-41, agency:/..., py:/...
  source_kind     text not null check (source_kind in ('doc_value','client','agency','prior_year')),
  label           text,
  field           text,
  value           jsonb,
  value_type      text,
  text_as_read    text,
  doc_id          text,
  page            int,
  position        jsonb,                     -- {x0,y0,x1,y1}, fractions of the page
  confidence      numeric,
  author          text,
  as_of           timestamptz,
  extra           jsonb,                     -- record (agency), supporting_refs (prior year), person_id
  primary key (packet_id, id)
);
create index observations_doc_page on observations (packet_id, doc_id, page);

create table engine_versions (
  packet_id             text not null,
  version               text not null,
  computed_at           timestamptz not null,
  trigger               text,
  documents_used        text[] not null,
  documents_superseded  text[] not null,
  summary               jsonb not null,
  tax_effect_rates      jsonb not null,
  carryovers_out        jsonb not null,
  changes_from_previous jsonb not null,
  primary key (packet_id, version)
);

create table engine_lines (
  packet_id     text not null,
  version       text not null,
  key           text not null,
  ord           int not null,
  jurisdiction  text not null,
  form          text not null,
  line          text not null,
  label         text,
  value         jsonb,                       -- whole dollars, cents for 8949 lots, or text/dates/ratios
  rule          text,
  inputs        text[] not null,
  sources       text[] not null,
  note          text,
  primary key (packet_id, version, key),
  foreign key (packet_id, version) references engine_versions(packet_id, version)
);
create index engine_lines_sources on engine_lines using gin (sources);
create index engine_lines_inputs on engine_lines using gin (inputs);

create table engine_diagnostics (
  packet_id  text not null,
  version    text not null,
  seq        int not null,
  code       text not null,
  severity   text not null,
  message    text not null,
  refs       text[] not null,
  primary key (packet_id, version, seq)
);

create table asset_books (
  packet_id          text not null,
  version            text not null,
  asset_id           text not null,
  book               text not null check (book in ('federal','california','amt')),
  depreciation_2025  numeric,
  prior_accumulated  numeric,
  accumulated_end    numeric,
  primary key (packet_id, version, asset_id, book)
);

create table periods (
  packet_id  text not null,
  seq        int not null,
  kind       text not null,                  -- residency (work_location etc. become facts later)
  state      text not null,
  status     text,
  date_from  date not null,
  date_to    date,
  primary key (packet_id, seq)
);

-- Read-only after load: nobody but the service role (the seed script) may write.
do $$
declare t text;
begin
  foreach t in array array['packet_raw','documents','pages','observations','engine_versions',
                           'engine_lines','engine_diagnostics','asset_books','periods'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

create or replace function forbid_packet_change() returns trigger language plpgsql as $$
begin
  raise exception 'packet tables are immutable (% on %)', tg_op, tg_table_name;
end $$;

do $$
declare t text;
begin
  foreach t in array array['packet_raw','documents','pages','observations','engine_versions',
                           'engine_lines','engine_diagnostics','asset_books','periods'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function forbid_packet_change()',
                   t || '_immutable', t);
  end loop;
end $$;
