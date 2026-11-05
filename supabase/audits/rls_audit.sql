-- Read-only security audit of the shared project. Run with: npm run db:audit
-- Every row returned is a problem. An empty result means the check passed.

-- Public tables with RLS off.
select 'public table without RLS' as issue, c.relname as object
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity

union all

-- Public tables with RLS on but no policies. Nobody can use them through the API.
select 'public table without policies', c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and not exists (
    select 1 from pg_policy p where p.polrelid = c.oid
  )

union all

-- anon holding any table privilege in public.
select 'anon has a table privilege', table_name || ': ' || privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'

union all

-- Functions in exposed schemas that bypass the caller's rights.
select 'SECURITY DEFINER function in public', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef

union all

-- Public buckets, or buckets without a size limit.
select
  case when public then 'public storage bucket' else 'bucket without a size limit' end,
  id
from storage.buckets
where public or file_size_limit is null;
