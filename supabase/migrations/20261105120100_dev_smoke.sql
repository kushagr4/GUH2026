-- DEVELOPMENT SMOKE TEST ONLY. It proves that auth, RLS, storage and Realtime work
-- end to end, and it powers the /dev pages and integration tests. Do not build
-- product features on it. Removing it is covered in docs/supabase-setup.md.

create table public.dev_smoke_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dev_smoke_records is 'Infrastructure smoke test only. Not product data.';

create index dev_smoke_records_owner_created_idx
  on public.dev_smoke_records (owner_id, created_at desc);

create trigger dev_smoke_records_set_updated_at
  before update on public.dev_smoke_records
  for each row execute function private.set_updated_at();

revoke all on table public.dev_smoke_records from anon, public;
grant select, insert, update, delete on table public.dev_smoke_records to authenticated;
grant select, insert, update, delete on table public.dev_smoke_records to service_role;

alter table public.dev_smoke_records enable row level security;

create policy "dev_smoke_records: owner can read"
  on public.dev_smoke_records for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "dev_smoke_records: owner can insert"
  on public.dev_smoke_records for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "dev_smoke_records: owner can update"
  on public.dev_smoke_records for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "dev_smoke_records: owner can delete"
  on public.dev_smoke_records for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Realtime delivers row changes only to subscribers whose SELECT policy allows it.
alter publication supabase_realtime add table public.dev_smoke_records;

-- Private bucket with a 1 MB limit, because smoke files should stay tiny.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dev-smoke-private',
  'dev-smoke-private',
  false,
  1048576,
  array['text/plain', 'image/png', 'application/json']
);

create policy "dev-smoke-private: owner can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dev-smoke-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "dev-smoke-private: owner can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dev-smoke-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "dev-smoke-private: owner can update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'dev-smoke-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'dev-smoke-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "dev-smoke-private: owner can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'dev-smoke-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
