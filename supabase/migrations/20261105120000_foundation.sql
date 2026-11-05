-- Foundation shared by every feature: an updated_at trigger, per-user profiles,
-- and a private bucket for user uploads. No SECURITY DEFINER functions.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Runs with the caller's own rights and a pinned search_path. It lives in a
-- private schema so the Data API cannot expose it as an RPC.
create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles: one row per user, created by the app on first save
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Per-user profile data. A user can only reach their own row.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- New public tables get no default Data API grants, so every grant is explicit.
-- anon deliberately gets nothing.
revoke all on table public.profiles from anon, public;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: owner can insert"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles: owner can update"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "profiles: owner can delete"
  on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- user-uploads: private bucket for product features
-- Limits keep usage inside the free plan's 1 GB of storage.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-uploads',
  'user-uploads',
  false,
  5242880,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv', 'application/json'
  ]
);

-- Objects must sit in a folder named after their owner: <user id>/<file>.
create policy "user-uploads: owner can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'user-uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "user-uploads: owner can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'user-uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "user-uploads: owner can update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'user-uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'user-uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "user-uploads: owner can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'user-uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
