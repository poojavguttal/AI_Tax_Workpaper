-- Step 3: check results per engine version. Seeded by the check library; always
-- created open. Status changes come only from events (step 4), never row edits.

create table check_results (
  packet_id       text not null references packet_raw(id),
  version         text not null,
  id              text not null,             -- '<check>:<subject>', e.g. 'lot_basis:F8949.B.N1'
  check_name      text not null,
  kind            text not null check (kind in ('error','conflict','judgment','completeness','outside_filing')),
  subject         text not null,
  title           text not null,
  message         text not null,
  blocking        boolean not null,
  lines           text[] not null,
  facts           text[] not null,
  evidence        text[] not null,
  engine_value    jsonb,
  expected_value  jsonb,
  effect          jsonb not null,            -- {federal, california, federal_payments?, california_payments?, method}
  recommendation  jsonb,                     -- conflicts and judgments only; never closes the result
  alternatives    jsonb not null,
  due             date,
  requires        jsonb not null,            -- {action: correction|decision|disposition|acknowledgement, authority, signoff}
  primary key (packet_id, version, id)
);
create index check_results_kind on check_results (packet_id, version, kind);

alter table check_results enable row level security;
create policy check_results_read on check_results for select to authenticated using (true);
create trigger check_results_immutable before update or delete on check_results
  for each row execute function forbid_packet_change();
