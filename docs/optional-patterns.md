# Optional patterns

These are not installed or enabled. Use them only if your project needs them. All of them work on the free plan.

## Realtime: Broadcast and Presence

Database change events are already wired up through `useTableChanges`. For ephemeral updates that don't need saving, such as cursors, typing or live reactions, use Broadcast rather than writing to the database. It avoids per-subscriber authorization checks, and costs no database writes.

```ts
const supabase = createClient();
const channel = supabase.channel(`room:${roomId}`);

channel
  .on("broadcast", { event: "cursor" }, ({ payload }) => updateCursor(payload))
  .subscribe();

await channel.send({ type: "broadcast", event: "cursor", payload: { x, y } });

// On unmount:
void supabase.removeChannel(channel);
```

**Public channels can be joined by anyone with the publishable key.** Don't send anything private this way. For private channels, read [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization).

**Delete events:** Postgres can't check RLS on a deleted row, so a `DELETE` change event may reach other subscribers. With the default replica identity it carries only the primary key, so keep primary keys meaningless (UUIDs), and don't set `replica identity full` on tables with private data.

## Edge Functions

Next.js route handlers run your server code already, so you rarely need these. They suit webhooks that must run without your app, or Deno-specific code.

```bash
npx supabase functions new my-function
```

```bash
npx supabase functions deploy my-function --use-api
```

`--use-api` bundles on Supabase's servers, so no Docker is needed. Without that flag, deploying can need it. Local testing with `functions serve` runs in containers, so test on the deployed function instead. Only the migration owner can deploy, and deployment asks for confirmation.

Read secrets with `Deno.env.get()`, set them with `npx supabase secrets set NAME=value --remote`, and never commit them.

## OAuth sign-in (GitHub or Google)

Free, but needs setup in the provider's console, and takes about 15 minutes. `/auth/callback` already handles the redirect.

1. Create an OAuth app with the provider. Its callback URL is `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Add the client ID and secret in the dashboard under **Authentication > Sign In / Providers**.
3. Add your site to **Redirect URLs**.
4. Add a button that runs this in a Server Action:

```ts
const { data } = await supabase.auth.signInWithOAuth({
  provider: "github",
  options: { redirectTo: `${origin}/auth/callback` },
});
if (data.url) redirect(data.url);
```

## Custom SMTP for real email

The built-in mailer only reaches organisation members at about 2 messages an hour. If you truly need email, such as password resets for real users, add a provider with a free tier (for example Resend or Brevo) under **Authentication > Emails > SMTP Settings**. It needs a verified domain, which takes time, so avoid this on the day unless it's central to the idea.

## Public read access

For content anyone can see, such as a public feed, you need three things on purpose:

```sql
-- migration-allow: public-access anyone can read published posts
grant select on table public.posts to anon, authenticated;

create policy "posts: anyone can read published"
  on public.posts for select to anon, authenticated
  using (published = true);
```

Select only safe columns. Never use `using (true)` on a table that has private columns.

## Shared or team data

The starter's policies are owner-only. For data shared between users, add a membership table, and check it in the policy:

```sql
create policy "documents: members can read"
  on public.documents for select to authenticated
  using (
    exists (
      select 1 from public.document_members m
      where m.document_id = documents.id
        and m.user_id = (select auth.uid())
    )
  );
```

Index `document_members (document_id, user_id)`, because this runs for every row. Policies on a table can't safely query that same table, and that's the classic cause of "infinite recursion" errors. Keep membership in its own table, with a simple policy of its own.

## Public buckets

Keep files private, and use `createSignedUrl` for access. If you need permanent public images, make a new bucket with a waiver and a strict limit:

```sql
-- migration-allow: public-bucket avatars are public by design
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']);
```

Never allow HTML or SVG uploads in a public bucket, because they can run scripts.
