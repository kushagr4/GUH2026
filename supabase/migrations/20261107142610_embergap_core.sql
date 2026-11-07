-- EmberGap core schema (contracts: src/lib/embergap/contracts.ts).
--
-- Who writes what:
-- - Reporters insert their own reports and report_media rows, through
--   POST /api/embergap/reports with their own session. Nothing else.
-- - A trigger opens the linked investigation and records the first event in the
--   same statement, so reporters never need write access to either table.
-- - Agent workers write observations, agent_findings and agent_events with the
--   service role (they have no user session). Those three tables are append-only.
-- - Reviewers (app_metadata.embergap_role = 'reviewer', which users cannot edit)
--   read everything and record review outcomes. Nobody else changes a status
--   except the service role.
--
-- Who reads what: reporters see their own reports, photos and investigations;
-- everyone signed in sees synthetic demo data; reviewers see everything. Child
-- rows inherit visibility from their investigation. Read models never select
-- owner_id, so reporter identity never leaves the database.
--
-- migration-allow: security-definer private.embergap_open_investigation() is a trigger function that writes investigations and agent_events, which reporters hold no grant for; it lives in the non-exposed private schema, pins search_path to '', and uses only NEW.

-- ---------------------------------------------------------------------------
-- report_media: a photo already uploaded to the private bucket
-- ---------------------------------------------------------------------------
create table public.report_media (
  -- The mediaId the browser used in the object path.
  id uuid primary key,
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  object_path text not null unique check (char_length(object_path) <= 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  -- Fingerprint of the verified bytes, for spotting one photo in several reports.
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  constraint report_media_owner_required check (is_synthetic or owner_id is not null),
  constraint report_media_path_matches check (
    is_synthetic
    or object_path = owner_id::text || '/' || id::text || '.' || case mime_type
      when 'image/jpeg' then 'jpg'
      when 'image/png' then 'png'
      else 'webp'
    end
  )
);

comment on table public.report_media is 'EmberGap report photos. Private: owner, reviewers, and synthetic only.';

create index report_media_owner_created_idx on public.report_media (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- investigations: one per report for the MVP
-- ---------------------------------------------------------------------------
create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  -- The reporter who opened it, for RLS only. Null for synthetic data. Never exposed.
  owner_id uuid references auth.users (id) on delete cascade,
  status text not null default 'unreviewed' check (
    status in ('unreviewed', 'investigating', 'needs_human_review', 'insufficient_evidence', 'reviewed')
  ),
  review_priority text check (review_priority in ('low', 'medium', 'high')),
  -- Coarsened copy of the report location (2 decimal places, about 1.1 km).
  public_latitude numeric(4, 2) not null check (public_latitude between -90 and 90),
  public_longitude numeric(5, 2) not null check (public_longitude between -180 and 180),
  public_precision_m integer not null check (public_precision_m between 1 and 100000),
  report_count integer not null default 0 check (report_count >= 0),
  -- Sources with at least one report or observation, kept current by triggers.
  sources text[] not null default '{}' check (sources <@ array['human', 'firms', 'eonet', 'weather', 'vision']),
  latest_evidence_at timestamptz,
  review_outcome text check (review_outcome in ('supported', 'not_supported', 'duplicate', 'inconclusive')),
  review_note text check (char_length(review_note) between 1 and 2000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  is_synthetic boolean not null default false,
  synthetic_scenario_id text check (char_length(synthetic_scenario_id) between 1 and 100),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint investigations_owner_required check (is_synthetic or owner_id is not null),
  constraint investigations_review_consistent check (
    case when status = 'reviewed'
      then review_outcome is not null and reviewed_at is not null
      else review_outcome is null and reviewed_at is null
    end
  )
);

comment on table public.investigations is 'EmberGap investigations. Status "reviewed" is set only by a human reviewer.';

create index investigations_owner_opened_idx on public.investigations (owner_id, opened_at desc);
create index investigations_location_idx on public.investigations (public_latitude, public_longitude);
create index investigations_updated_idx on public.investigations (updated_at desc);

create trigger investigations_set_updated_at
  before update on public.investigations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- reports: a reporter's unverified claim
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  -- Set by the trigger below; reporters cannot choose it.
  investigation_id uuid not null references public.investigations (id) on delete cascade,
  client_request_id uuid not null,
  observed_at timestamptz not null,
  -- Where the smoke or fire is believed to be, stored at 3 decimal places (about 110 m).
  latitude numeric(5, 3) not null check (latitude between -90 and 90),
  longitude numeric(6, 3) not null check (longitude between -180 and 180),
  location_uncertainty_m integer not null check (location_uncertainty_m between 100 and 50000),
  description text not null check (char_length(description) between 10 and 2000),
  media_id uuid unique references public.report_media (id) on delete set null,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  constraint reports_owner_required check (is_synthetic or owner_id is not null),
  constraint reports_owner_request_unique unique (owner_id, client_request_id),
  constraint reports_observed_window check (
    observed_at <= created_at + interval '5 minutes'
    and observed_at >= created_at - interval '72 hours'
  )
);

comment on table public.reports is 'EmberGap human reports: unverified claims. Private: owner, reviewers, and synthetic only.';

create index reports_owner_created_idx on public.reports (owner_id, created_at desc);
create index reports_investigation_idx on public.reports (investigation_id);

-- Opens the investigation and records the first event in the same statement as
-- the report insert. If the report is rejected (a check, or a replayed
-- client_request_id), all three roll back together.
create function private.embergap_open_investigation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if new.investigation_id is null then
    insert into public.investigations (
      owner_id, public_latitude, public_longitude, public_precision_m,
      report_count, sources, latest_evidence_at, is_synthetic, opened_at
    )
    values (
      new.owner_id,
      pg_catalog.round(new.latitude, 2),
      pg_catalog.round(new.longitude, 2),
      greatest(1000, new.location_uncertainty_m),
      1,
      array['human'],
      new.observed_at,
      new.is_synthetic,
      new.created_at
    )
    returning id into target_id;
    new.investigation_id := target_id;
  else
    -- Reporters cannot set investigation_id (no column grant). Only the service
    -- role links a report to an existing investigation: synthetic data, duplicates.
    update public.investigations
      set report_count = report_count + 1,
          sources = case when 'human' = any (sources) then sources else pg_catalog.array_append(sources, 'human') end,
          latest_evidence_at = greatest(latest_evidence_at, new.observed_at)
      where id = new.investigation_id;
  end if;

  insert into public.agent_events (
    investigation_id, type, actor, occurred_at, idempotency_key, summary, details, is_synthetic
  )
  values (
    new.investigation_id,
    'report_submitted',
    'reporter',
    new.created_at,
    'report_submitted:' || new.id::text,
    'A report was submitted. It is unverified until a human reviews it.',
    pg_catalog.jsonb_build_object('reportId', new.id, 'hasMedia', new.media_id is not null),
    new.is_synthetic
  );

  return new;
end;
$$;

revoke all on function private.embergap_open_investigation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- observations: one source's data for one investigation (append-only)
-- ---------------------------------------------------------------------------
create table public.observations (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations (id) on delete cascade,
  source text not null check (source in ('human', 'firms', 'eonet', 'weather', 'vision')),
  source_record_id text check (char_length(source_record_id) between 1 and 200),
  source_state text not null check (source_state in ('available', 'stale', 'unavailable', 'not_observed')),
  observed_at timestamptz,
  retrieved_at timestamptz not null default now(),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  coverage jsonb check (coverage is null or jsonb_typeof(coverage) = 'object'),
  evidence jsonb check (
    evidence is null or (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16384)
  ),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object' and octet_length(provenance::text) <= 4096),
  is_synthetic boolean not null default false,
  recorded_at timestamptz not null default now(),
  constraint observations_coordinates_paired check ((latitude is null) = (longitude is null)),
  constraint observations_data_complete check (
    source_state not in ('available', 'stale') or (observed_at is not null and evidence is not null)
  ),
  constraint observations_not_observed_has_coverage check (source_state <> 'not_observed' or coverage is not null),
  constraint observations_source_record_unique unique (investigation_id, source, source_record_id)
);

comment on table public.observations is 'EmberGap source observations. Append-only. "not_observed" is not evidence of absence.';

create index observations_investigation_idx on public.observations (investigation_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- agent_findings: independent, append-only assessments
-- ---------------------------------------------------------------------------
create table public.agent_findings (
  -- Supplied by the agent and stable across redelivery, so a duplicate is a no-op.
  id uuid primary key,
  investigation_id uuid not null references public.investigations (id) on delete cascade,
  -- The report this finding assesses, or null for investigation-wide findings.
  report_id uuid references public.reports (id) on delete cascade,
  agent_id text not null check (agent_id in ('vision', 'satellite', 'weather', 'witness', 'fusion')),
  assessment text not null check (assessment in ('supports', 'contradicts', 'inconclusive', 'context')),
  strength text check (strength in ('weak', 'moderate', 'strong')),
  evidence_ids uuid[] not null default '{}' check (cardinality(evidence_ids) <= 100),
  reason_codes text[] not null check (cardinality(reason_codes) between 1 and 20),
  explanation text not null check (char_length(explanation) between 1 and 2000),
  limitations text[] not null default '{}' check (cardinality(limitations) <= 20),
  limitation_notes text[] not null default '{}' check (cardinality(limitation_notes) <= 10),
  recommendation jsonb check (recommendation is null or jsonb_typeof(recommendation) = 'object'),
  is_synthetic boolean not null default false,
  created_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  -- The scientific limits from the contracts, enforced here too.
  constraint agent_findings_satellite_never_contradicts check (not (agent_id = 'satellite' and assessment = 'contradicts')),
  constraint agent_findings_weather_is_context check (agent_id <> 'weather' or assessment in ('context', 'inconclusive')),
  constraint agent_findings_vision_limits check (
    agent_id <> 'vision'
    or limitations @> array['image_authenticity_unverifiable', 'image_location_unverifiable', 'image_time_unverifiable']
  ),
  constraint agent_findings_only_fusion_recommends check ((agent_id = 'fusion') = (recommendation is not null)),
  constraint agent_findings_recommendation_status check (
    recommendation is null
    or recommendation ->> 'recommendedStatus' in ('investigating', 'needs_human_review', 'insufficient_evidence')
  ),
  constraint agent_findings_fusion_is_context check (agent_id <> 'fusion' or (assessment = 'context' and strength is null)),
  constraint agent_findings_strength_directional check (strength is null or assessment in ('supports', 'contradicts'))
);

comment on table public.agent_findings is 'EmberGap agent findings. Append-only. Findings never confirm an incident.';

create index agent_findings_investigation_idx on public.agent_findings (investigation_id, created_at desc);
create index agent_findings_report_idx on public.agent_findings (report_id) where report_id is not null;

-- ---------------------------------------------------------------------------
-- agent_events: the investigation timeline (append-only, idempotent)
-- ---------------------------------------------------------------------------
create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations (id) on delete cascade,
  type text not null check (
    type in (
      'report_submitted', 'task_queued', 'message_sent', 'message_delivered', 'message_dropped',
      'duplicate_ignored', 'partition_started', 'partition_healed', 'reconciled',
      'finding_recorded', 'status_changed', 'review_recorded'
    )
  ),
  actor text not null check (
    actor in ('vision', 'satellite', 'weather', 'witness', 'fusion', 'system', 'reporter', 'reviewer')
  ),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  message_id uuid,
  summary text not null check (char_length(summary) between 1 and 300),
  details jsonb check (details is null or (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 16384)),
  is_synthetic boolean not null default false,
  constraint agent_events_idempotency_unique unique (investigation_id, idempotency_key)
);

comment on table public.agent_events is 'EmberGap investigation timeline. Append-only; re-recording an idempotency key is a no-op.';

create index agent_events_investigation_idx on public.agent_events (investigation_id, occurred_at desc);

-- The trigger needs agent_events, so attach it last.
create trigger reports_open_investigation
  before insert on public.reports
  for each row execute function private.embergap_open_investigation();

-- Append-only: nobody, not even the service role, rewrites history.
create function private.embergap_reject_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'EmberGap % rows are append-only.', tg_table_name using errcode = '42501';
end;
$$;

revoke all on function private.embergap_reject_update() from public, anon, authenticated;

create trigger observations_append_only before update on public.observations
  for each row execute function private.embergap_reject_update();
create trigger agent_findings_append_only before update on public.agent_findings
  for each row execute function private.embergap_reject_update();
create trigger agent_events_append_only before update on public.agent_events
  for each row execute function private.embergap_reject_update();

-- New evidence moves the investigation up the map and dashboard. Workers insert
-- with the service role, which may update investigations.
create function private.embergap_note_observation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.investigations
    set latest_evidence_at = greatest(latest_evidence_at, new.observed_at),
        sources = case when new.source = any (sources) then sources else pg_catalog.array_append(sources, new.source) end
    where id = new.investigation_id;
  return null;
end;
$$;

create function private.embergap_note_finding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.investigations set updated_at = pg_catalog.now() where id = new.investigation_id;
  return null;
end;
$$;

revoke all on function private.embergap_note_observation() from public, anon, authenticated;
revoke all on function private.embergap_note_finding() from public, anon, authenticated;

create trigger observations_note_investigation after insert on public.observations
  for each row execute function private.embergap_note_observation();
create trigger agent_findings_note_investigation after insert on public.agent_findings
  for each row execute function private.embergap_note_finding();

-- ---------------------------------------------------------------------------
-- Grants. Nothing for anon. Reporters may insert only the listed columns.
-- Revoking from authenticated too removes the platform's default TRUNCATE,
-- TRIGGER and REFERENCES, because TRUNCATE ignores RLS.
-- ---------------------------------------------------------------------------
revoke all on table public.report_media, public.investigations, public.reports,
  public.observations, public.agent_findings, public.agent_events from anon, public, authenticated;

grant select on table public.report_media to authenticated;
grant insert (id, object_path, mime_type, size_bytes, sha256) on table public.report_media to authenticated;

grant select on table public.reports to authenticated;
grant insert (client_request_id, observed_at, latitude, longitude, location_uncertainty_m, description, media_id)
  on table public.reports to authenticated;

grant select on table public.investigations to authenticated;
grant update (status, review_outcome, review_note, reviewed_at, reviewed_by) on table public.investigations to authenticated;

grant select on table public.observations to authenticated;
grant select on table public.agent_findings to authenticated;
grant select on table public.agent_events to authenticated;

grant select, insert, update, delete on table public.report_media, public.investigations, public.reports to service_role;
grant select, insert, delete on table public.observations, public.agent_findings, public.agent_events to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.report_media enable row level security;
alter table public.investigations enable row level security;
alter table public.reports enable row level security;
alter table public.observations enable row level security;
alter table public.agent_findings enable row level security;
alter table public.agent_events enable row level security;

-- Reviewer status comes from app_metadata in the signed JWT. Users can edit
-- user_metadata but not app_metadata, so they cannot grant it to themselves.

create policy "report_media: owner can read"
  on public.report_media for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "report_media: reviewer can read"
  on public.report_media for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'embergap_role') = 'reviewer');

create policy "report_media: synthetic is readable"
  on public.report_media for select to authenticated
  using (is_synthetic);

create policy "report_media: owner can insert"
  on public.report_media for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "reports: owner can read"
  on public.reports for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "reports: reviewer can read"
  on public.reports for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'embergap_role') = 'reviewer');

create policy "reports: synthetic is readable"
  on public.reports for select to authenticated
  using (is_synthetic);

create policy "reports: owner can insert"
  on public.reports for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (
      media_id is null
      or exists (
        select 1 from public.report_media m
        where m.id = media_id and m.owner_id = (select auth.uid())
      )
    )
  );

create policy "investigations: reporter can read"
  on public.investigations for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "investigations: reviewer can read"
  on public.investigations for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'embergap_role') = 'reviewer');

create policy "investigations: synthetic is readable"
  on public.investigations for select to authenticated
  using (is_synthetic);

create policy "investigations: reviewer can record a review"
  on public.investigations for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'embergap_role') = 'reviewer')
  with check (
    ((select auth.jwt()) -> 'app_metadata' ->> 'embergap_role') = 'reviewer'
    and (reviewed_by is null or reviewed_by = (select auth.uid()))
  );

-- Child rows are visible exactly when their investigation is.
create policy "observations: visible with their investigation"
  on public.observations for select to authenticated
  using (exists (select 1 from public.investigations i where i.id = investigation_id));

create policy "agent_findings: visible with their investigation"
  on public.agent_findings for select to authenticated
  using (exists (select 1 from public.investigations i where i.id = investigation_id));

create policy "agent_events: visible with their investigation"
  on public.agent_events for select to authenticated
  using (exists (select 1 from public.investigations i where i.id = investigation_id));

-- Live timelines and findings. Realtime honours the select policies above.
alter publication supabase_realtime add table public.investigations, public.agent_findings, public.agent_events;

-- ---------------------------------------------------------------------------
-- Private bucket for report photos: <user id>/<media id>.<jpg|png|webp>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'embergap-report-media',
  'embergap-report-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
);

create policy "embergap-report-media: owner can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'embergap-report-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );

create policy "embergap-report-media: owner can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'embergap-report-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "embergap-report-media: owner can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'embergap-report-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "embergap-report-media: reviewer can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'embergap-report-media'
    and ((select auth.jwt()) -> 'app_metadata' ->> 'embergap_role') = 'reviewer'
  );

-- ---------------------------------------------------------------------------
-- Synthetic demo scenarios. Labelled is_synthetic, readable by every signed-in
-- user, and fixed so every laptop and the hosted demo show the same data. IDs
-- are syntheticId("core/<scenario>/investigation" | ".../report") from the
-- contracts. Places are real moorland; the reports are invented.
-- ---------------------------------------------------------------------------
insert into public.investigations (
  id, public_latitude, public_longitude, public_precision_m, is_synthetic, synthetic_scenario_id, opened_at
)
values
  ('00000000-1923-4596-a095-774098c7d58b', 53.55, -1.98, 1000, true, 'corroborated-smoke', '2026-11-07T09:12:00Z'),
  ('00000000-09fe-4107-b776-6dd00f9c3170', 53.63, -2.52, 1000, true, 'misleading-photo', '2026-11-07T09:44:00Z'),
  ('00000000-0b9a-4749-91c0-8a00faa295dd', 53.38, -1.87, 1000, true, 'missing-satellite-pass', '2026-11-07T10:20:00Z'),
  ('00000000-0d80-4774-bb4d-26102d4b14fe', 53.60, -1.93, 1500, true, 'weather-timeout', '2026-11-07T10:55:00Z'),
  ('00000000-1653-4361-8829-3801c69d3012', 53.91, -1.83, 1000, true, 'repeated-witness', '2026-11-07T11:25:00Z'),
  ('00000000-1146-409b-8d51-0ea14dfbfa8f', 53.46, -1.85, 1000, true, 'partition-recovery', '2026-11-07T11:50:00Z');

-- The trigger counts each report and records its report_submitted event.
insert into public.reports (
  id, investigation_id, client_request_id, observed_at, latitude, longitude,
  location_uncertainty_m, description, is_synthetic, created_at
)
values
  ('00000000-106e-47a9-a6eb-db11ac53887f', '00000000-1923-4596-a095-774098c7d58b', '00000000-106e-47a9-a6eb-db11ac53887f',
   '2026-11-07T09:05:00Z', 53.546, -1.982, 500,
   'Thick grey smoke rising from the moorland east of the reservoir, drifting north-east.', true, '2026-11-07T09:12:00Z'),
  ('00000000-147e-4fbf-9e3e-fea1cf9c16c3', '00000000-09fe-4107-b776-6dd00f9c3170', '00000000-147e-4fbf-9e3e-fea1cf9c16c3',
   '2026-11-07T09:40:00Z', 53.625, -2.521, 1000,
   'White plume over the hill top. It might be low cloud, but it looked like smoke from the road.', true, '2026-11-07T09:44:00Z'),
  ('00000000-0d26-4143-b8e1-aff19fe18752', '00000000-0b9a-4749-91c0-8a00faa295dd', '00000000-0d26-4143-b8e1-aff19fe18752',
   '2026-11-07T10:15:00Z', 53.384, -1.872, 750,
   'Orange glow and smoke near the plateau edge, seen from the visitor centre car park.', true, '2026-11-07T10:20:00Z'),
  ('00000000-1fc0-4323-a8e3-55314f1a4833', '00000000-0d80-4774-bb4d-26102d4b14fe', '00000000-1fc0-4323-a8e3-55314f1a4833',
   '2026-11-07T10:50:00Z', 53.602, -1.931, 1500,
   'Smoke column behind the ridge, getting darker over about ten minutes.', true, '2026-11-07T10:55:00Z'),
  ('00000000-0318-4966-86dd-1d30955a62f6', '00000000-1653-4361-8829-3801c69d3012', '00000000-0318-4966-86dd-1d30955a62f6',
   '2026-11-07T11:20:00Z', 53.913, -1.832, 500,
   'Smoke near the rocks on the moor top, visible from the town centre.', true, '2026-11-07T11:25:00Z'),
  ('00000000-040f-47a7-a7ac-7ba099c9d49f', '00000000-1653-4361-8829-3801c69d3012', '00000000-040f-47a7-a7ac-7ba099c9d49f',
   '2026-11-07T11:28:00Z', 53.914, -1.831, 500,
   'Same smoke as before, still rising near the rocks on the moor.', true, '2026-11-07T11:31:00Z'),
  ('00000000-0257-499c-9b8e-9c81906653c9', '00000000-1146-409b-8d51-0ea14dfbfa8f', '00000000-0257-499c-9b8e-9c81906653c9',
   '2026-11-07T11:45:00Z', 53.462, -1.853, 1000,
   'Smoke drifting west from the peat area, and a smell of burning on the wind.', true, '2026-11-07T11:50:00Z');
