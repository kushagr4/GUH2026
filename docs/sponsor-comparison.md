# Sponsor technology: Firecrawl, Lovable and GitHub

Researched from official documentation on **7 November 2026**. Free tiers and prize rules change, so confirm anything important at the event. Where the docs were unclear or contradicted each other, this page says so.

Strategy, the decision matrix and project concepts are in [sponsor-strategy.md](sponsor-strategy.md). The code pattern is in [integrations.md](integrations.md).

## At a glance

| | Firecrawl | Lovable | GitHub |
| --- | --- | --- | --- |
| **What it is** | API that turns web pages into markdown or structured JSON | AI app builder that generates and hosts web apps | Code hosting, plus APIs, Actions, OAuth and webhooks |
| **Setup** | Sign up, copy an `fc-` key into `.env.local` | Sign up, build in the browser | REST works with no setup. A token, OAuth App or webhook takes about 5 minutes each |
| **Free tier** | 1,000 credits, 10 requests a minute, 2 browsers at once, no card | 5 build credits a day (30 a month cap), publish to `*.lovable.app` | Public REST: 60 requests an hour. With a token: 5,000 an hour |
| **Fits our stack** | Very well. Server-side REST, results stored in Supabase | As a **separate** app only. It can't edit our Next.js repo | Very well. REST client ready, Supabase supports GitHub login |
| **Difficulty in 6 h** | Low | Low for a separate app, and **high** if you try to merge it with ours | Low (REST, login) to medium (webhooks, Actions bots) |
| **Main risk** | Credits and rate limit during a live demo | It changing the shared database, which breaks our migration rules | Unauthenticated rate limit on shared venue Wi-Fi |
| **Ready in this repo** | `src/lib/integrations/firecrawl.ts`, off until a key is set | Guidance below. Nothing to install | `src/lib/integrations/github.ts`, webhook verification |

---

## Firecrawl

### Setup

1. Sign up at [firecrawl.dev](https://www.firecrawl.dev/pricing). The free plan needs no card.
2. Students can get 10,000 credits with an academic email, using a code entered under Settings, Billing. The [student programme page](https://www.firecrawl.dev/student-program) lists hackathons as an allowed use. It doesn't say how long the credits last.
3. Add `FIRECRAWL_API_KEY=fc-…` to `.env.local` (and to Vercel if you deploy), then restart.
4. Open `/dev/integrations` and press **Scrape**. That costs 1 credit.

### Free tier

From [pricing](https://www.firecrawl.dev/pricing), [rate limits](https://docs.firecrawl.dev/rate-limits) and [billing](https://docs.firecrawl.dev/billing):

| Item | Free plan |
| --- | --- |
| Credits | 1,000. One source says monthly and another doesn't say |
| `/scrape`, `/search`, `/map` | 10 requests a minute each |
| `/crawl` | 2 requests a minute |
| Concurrent browsers | 2. Extra jobs queue, and queue time counts toward the timeout |
| Scrape as markdown | 1 credit a page |
| Scrape as structured JSON | 5 credits a page (1 + 4) |
| Search | 2 credits per 10 results, plus scraping costs if you ask for page content |
| PDF pages | 1 extra credit each |

**Budget:** 1,000 credits is about 200 JSON extractions or 1,000 plain scrapes. Firecrawl still charges for a page that loads with a 403 or 404 status.

### API (v2)

Base URL `https://api.firecrawl.dev/v2`, header `Authorization: Bearer fc-…`. [Scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

| Endpoint | Use | Sync? | In our client |
| --- | --- | --- | --- |
| `POST /scrape` | One page as markdown, summary, links, or JSON matching a schema | Yes | `scrape()`, `extract()` |
| `POST /search` | Web search, optionally scraping each result | Yes | `search()` |
| `POST /map` | List a site's URLs (1 credit) | Yes | Use `request` pattern if needed |
| `POST /crawl` | Many pages of one site. Always set a low `limit` | No, poll for the job | Not included |
| `POST /extract`, `POST /agent` | Multi-page extraction jobs. `/agent` is described as the successor to `/extract` | No, poll for the job | Not included. Costs are less predictable |

Structured extraction uses a format object, not the older `extract` or `jsonOptions` fields:

```json
{
  "url": "https://example.com/product",
  "formats": [{ "type": "json", "schema": { "type": "object", "properties": { "price": { "type": "number" } } }, "prompt": "The product's price" }],
  "onlyMainContent": true,
  "timeout": 30000
}
```

The result is in `data.json`, and the page's own status is in `data.metadata.statusCode`. The OpenAPI page doesn't list `data.json`. Firecrawl's own SDK types do ([`v2/types.ts`](https://github.com/firecrawl/firecrawl/blob/main/apps/js-sdk/firecrawl/src/v2/types.ts)), and our client follows them, tolerating unknown fields. Search results can be plain hits or, with `withContent`, full documents whose URL is in `metadata.sourceURL`. A 200 response with `success: false` is a failure, as the SDK treats it. Nobody has made a live call with a real key yet.

Errors come back as `{ "success": false, "error": "…" }`, as listed in [errors](https://docs.firecrawl.dev/api-reference/errors):
- 401 is a bad key.
- 402 means out of credits.
- 403 means the key lacks permission or the site is unsupported.
- 408 means the page timed out.
- 429 means the rate or concurrency limit was hit.
- 5xx are server errors.

Our client maps all of these to `IntegrationError` kinds.

### Approach: structured data from public websites

Keep this optional until Firecrawl's sponsorship and prize eligibility are confirmed. Nothing runs, and nothing costs anything, until `FIRECRAWL_API_KEY` is set.

1. **Define the shape** you want with zod. The client converts it to JSON Schema for Firecrawl and validates what comes back:

   ```ts
   const eventSchema = z.object({
     name: z.string(),
     date: z.string().describe("ISO date, if shown"),
     location: z.string().optional(),
     price: z.number().optional(),
   });
   const { data, page } = await getFirecrawl().extract(url, eventSchema, {
     prompt: "The main event on this page",
   });
   ```

2. **Call it from a Server Action**, with a per-user limit (see [integrations.md](integrations.md)).
3. **Store the result in Supabase**, in a table such as `extractions (owner_id, url, data jsonb, fetched_at)`, created through a normal migration with RLS. Check the table before calling Firecrawl again, so a repeat view costs nothing.
4. **Show it** from the table. Add `useTableChanges` if other people should see results appear live.
5. **Demo safety.** Pre-load the demo URLs before judging, so the live demo reads from Supabase and only one extraction happens live.

**Gotchas:**
- Pages that load content with JavaScript may need `waitForMs`.
- A live JSON scrape takes several seconds, so show a pending state.
- Use public pages only. Don't scrape pages behind a login or social media, which Firecrawl may refuse with a 403.
- The official docs say little about robots.txt. Respect it, and each site's terms, anyway.

---

## Lovable

### What it generates, and what it can't do

These points come from [Lovable's docs](https://docs.lovable.dev):
- **New projects use TanStack Start** (since 13 May 2026). Older projects used React and Vite. **It doesn't generate Next.js** ([upgrade page](https://docs.lovable.dev/features/upgrade-to-tanstack-start.md)).
- **It can't edit our repository.** "Git sync always creates a new repository" ([GitHub integration](https://docs.lovable.dev/integrations/github)). Importing code rebuilds it on Lovable's own stack, so importing our app would rewrite it.
- GitHub sync is two-way on one branch: Lovable's edits are pushed, and pushes to that branch come back.
- **Its Supabase integration changes the connected project.** It writes SQL and runs it after you approve it in chat, saves migrations in *its* repo, and deploys Edge Functions ([Supabase integration](https://docs.lovable.dev/integrations/supabase)). Its built-in backend, Lovable Cloud, is the default.

### Free plan

From [plans and credits](https://docs.lovable.dev/introduction/plans-and-credits) and [deploy](https://docs.lovable.dev/features/deploy):
- 5 build credits a day, capped at 30 a month. Spend them on deliberate prompts, not trial and error.
- Publishing to `<name>.lovable.app` is free. Custom domains need Pro.
- Students get 50% off Pro. That's a discount, not free credits.
- Client-side variables (`VITE_*`) are public, like our `NEXT_PUBLIC_*`.

### How it can coexist with our setup

**Never connect Lovable's Supabase integration to the shared project.** It would apply schema changes outside our migration files and the migration owner, and deploy functions to the shared project. That breaks [team-workflow.md](team-workflow.md).

The safe options, from simplest:

| Option | How | Shares our data? | Effort |
| --- | --- | --- | --- |
| **A. Separate micro-app** | Build a landing page, pitch site or admin view in Lovable with mock data or Lovable Cloud. Link to our app | No | 30 to 60 min |
| **B. Prototype, then port** | Design a screen in Lovable, then copy its components into `src/components` or `src/features/<x>/components` | Through our app | 15 to 30 min a screen |
| **C. Second frontend, same backend** | The Lovable app uses `@supabase/supabase-js` with our **URL and publishable key only**, never the integration. RLS protects the data as it does for our app | Yes, read and write as the signed-in user | 1 to 2 h |

**Porting a component (option B):**
- Add `"use client"` to anything with hooks or event handlers.
- Replace the router's links and navigation with `next/link` and `next/navigation`.
- Replace `import.meta.env.VITE_*` with `process.env.NEXT_PUBLIC_*`.
- Remove Lovable's own Supabase client and use ours.
- Check the shadcn component names against `src/components/ui`, adding missing ones with `npx shadcn@4.23.0 add <name>`.

**Option C notes:**
- Tell Lovable in the first prompt that the database schema is fixed, and paste `src/lib/supabase/database.types.ts`. That stops it inventing tables.
- If users sign in on the Lovable app, the migration owner must add its `lovable.app` URL to `additional_redirect_urls` in `supabase/config.toml`, then run `npx supabase config push --remote`.
- To call our API routes from it instead, we would have to add CORS headers for that origin. We haven't built that.

---

## GitHub, beyond hosting

| Option | What it gives a project | Effort | Notes |
| --- | --- | --- | --- |
| **REST API** | Repos, issues, PRs, commits, contributors | Ready | `getGitHub()` works with no token at 60 requests an hour per server IP. Set `GITHUB_API_TOKEN` (fine-grained, read-only) for 5,000 an hour. On venue Wi-Fi many teams share one IP, so use a token for the demo. [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| **Sign in with GitHub** | Developer-focused login, alongside email | About 20 min | Create a GitHub OAuth App with callback `https://<project-ref>.supabase.co/auth/v1/callback`, then enable GitHub under Authentication, Providers ([Supabase guide](https://supabase.com/docs/guides/auth/social-login/auth-github)). That guide doesn't mention plan limits, so confirm there's no charge prompt. Call `supabase.auth.signInWithOAuth({ provider: "github" })`; our `/auth/callback` route already exchanges the code |
| **Webhooks** | Live push, issue and PR events into the app | About 45 min | `verifyWebhookSignature` checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw body). Needs a deployed, public URL ([docs](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)) |
| **Actions** | Bots: PR summaries, issue triage, scheduled jobs | 30 to 90 min | CI already runs. Free private-repo usage is a $12 monthly allowance, about 2,000 Linux minutes ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). Store keys as repository secrets |
| **GitHub App** | Acting on many repos with short-lived tokens | 2 h or more | GitHub's recommended model, but too slow for 6 hours unless the App is the product |
| **Codespaces** | A browser dev environment for a teammate whose laptop fails | 10 min | 120 core-hours a month free, about 60 hours on 2 cores ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)). Everything in this repo runs without Docker, so it works there |
| **Pages** | Static hosting for a write-up or landing page | 15 min | Docs conflict about private repos on Free. Assume it needs a public repo |
| **Copilot** | Faster coding | None | Copilot Student is free for verified students |

**GitHub Models is gone.** It was retired on 30 July 2026, including its inference API ([changelog](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)). For AI, use our existing `src/lib/ai` (Anthropic, or the free mock provider).

**On a private repo, GitHub's security features are limited.** Secret scanning, push protection and CodeQL are free only for public repos. Dependabot works on any plan ([features](https://docs.github.com/en/code-security/getting-started/github-security-features)). Keep using `npm run secrets:scan`. If a prize requires a public repo, the history scan is already clean, so making it public is low risk. Run the scan again first anyway.
