# Free-plan limits, health checks and monitoring

The project stays on Supabase's free plan. These are the limits from Supabase's documentation as of November 2026, and how this project stays inside them. Check the [pricing page](https://supabase.com/pricing) if a number matters.

## Limits that matter

| Resource | Free plan | How this project stays safe |
| --- | --- | --- |
| Active projects | 2 | One shared project |
| Pausing | After 1 week of inactivity | Check it the day before (below) |
| Database size | 500 MB | Store text and metadata, with files in Storage. Length limits on columns |
| File storage | 1 GB | Buckets cap files at 5 MB (app) and 1 MB (smoke tests) |
| Egress | 5 GB | Paginate, select only the columns you need, and keep images small |
| Monthly active users | 50,000 | Not a concern at a hackathon |
| Realtime connections | 200 concurrent | One channel per component, closed on unmount |
| Realtime messages | 2 million a month, 100 a second | Filter to the rows you need, and enable only tables that need it |
| Edge Function invocations | 500,000 | Not used by default |
| Built-in auth email | About 2 an hour, organisation members only | "Confirm email" is off, and no flow depends on email |
| Sign-ups and sign-ins | 30 per 5 minutes per IP | Pre-create demo accounts (see below) |
| Token refreshes | 150 per 5 minutes per IP | Handled automatically by the client |

The venue network may put everyone behind one IP address, which makes the per-IP auth limit the one most likely to bite during a demo. The owner can raise it under **Authentication > Rate Limits**, and should have a demo account already created and signed in before presenting.

## Health check

Anyone can run this at any time. It uses only the publishable key, reads no rows, and makes a handful of small requests:

```bash
npm run health
```

It checks whichever project `.env.local` points at, which after `npm run local:dev` is your own local stack. To check the hosted project, the migration owner runs `npm run db:status`, or `npm run health` in a checkout whose `.env.local` points at hosted.

For a browser view of every service including your session, open `/dev` while running in development.

`GET /api/health` reports only whether the app is alive and makes no database call, so it's free to poll.

### Interpreting failures

| Output | Meaning | Action |
| --- | --- | --- |
| Can't reach the project, or HTTP 5xx | Paused or an outage | Owner checks the dashboard and restores the project, then checks [status.supabase.com](https://status.supabase.com) |
| Database: migrations not applied | Schema missing | Owner runs `npm run db:push` |
| Database: SECURITY PROBLEM | Anonymous access was allowed | Stop and fix the grants, then run `npm run db:audit` |

## Usage monitoring (owner)

There is no usage API in this repo, so the dashboard is the source of truth.

**Organisation > Usage** shows database size, storage, egress, monthly active users and Realtime usage against the limits.

| When | Do this |
| --- | --- |
| The day before | Sign in to the dashboard to confirm the project is active. Run `npm run db:status` |
| Morning of the event | Open the deployed app from the venue network and sign in with the demo account |
| During hacking | Glance at Organisation > Usage every couple of hours |
| Before the demo | Sign in to the deployed app with the demo account, and check `/api/health` |

For detail, use **Logs & Analytics** in the dashboard, or ask Claude Code to use the read-only Supabase MCP tools for logs and advisors.

## Habits that keep usage low

**Database**

- Select named columns, not `*`.
- Use `toPageRange` for lists, and index the columns you filter on.
- Use `getCurrentUser()`, which is cached per request, rather than calling auth repeatedly.
- Don't poll. Use Realtime where a page needs live data, or refresh on user action.

**Storage**

- Check the size in the browser with `validateUpload` before uploading.
- Shrink images before upload when you can.
- Delete test files when you're done.

**Realtime**

- Subscribe only on pages that show live data.
- Always pass a `filter` to `useTableChanges` when you can.
- Add a table to the `supabase_realtime` publication only when a screen needs it.
- For ephemeral updates such as cursors or typing, use Broadcast rather than writing to the database.

## If you hit a limit

| Limit | What to do without upgrading |
| --- | --- |
| Project paused | Restore from the dashboard. It's free but can take a few minutes, so check the day before |
| Auth rate limit | Wait 5 minutes, use a pre-created account, or raise it under Authentication > Rate Limits |
| Email errors | Confirm that "Confirm email" is off |
| Storage nearly full | Delete test files through the dashboard |
| Egress high | Find large responses and images, and shrink or paginate them |

**Do not upgrade the plan or enable add-ons.** Free-plan projects are limited rather than billed, and a limit can be worked around for one day.
