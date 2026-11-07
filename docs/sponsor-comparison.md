# Sponsor technology: ElevenLabs, n8n, Firecrawl, Lovable and GitHub

Researched from official documentation on **7 November 2026**. Free tiers and prize rules change, so confirm anything important at the event. Where the docs were unclear or contradicted each other, or something couldn't be verified, this page says so.

**Prize status:** "Best Use of ElevenLabs" and "Best Use of n8n" are confirmed prize categories on the official Devpost page, and **each team may enter only one sponsor challenge**. The others are sponsors whose prizes, if any, are announced at the opening ceremony. Details are in [sponsor-strategy.md](sponsor-strategy.md), along with the decision matrix and project concepts. The code pattern is in [integrations.md](integrations.md), and the live checks are in [live-verification.md](live-verification.md).

## At a glance

| | ElevenLabs | n8n | Firecrawl | Lovable | GitHub |
| --- | --- | --- | --- | --- | --- |
| **Prize** | **Confirmed** | **Confirmed** | Unknown | Unknown | Unknown |
| **What it is** | Speech API: text-to-speech, speech-to-text, voice agents | Workflow automation with a visual editor | Web pages to markdown or structured JSON | AI app builder that hosts apps | APIs, Actions, OAuth and webhooks |
| **Setup** | Sign up, create a restricted key | Cloud trial (no card) or `npx n8n` (no Docker) | Sign up, copy an `fc-` key | Sign up, build in the browser | REST works now. A token takes 5 min |
| **Free tier** | 10,000 credits a month, 2 requests at once | No free cloud plan. Self-hosting is free | 1,000 credits, 10 requests a minute | 5 build credits a day | 60 requests an hour, or 5,000 with a token |
| **Fits our stack** | Very well, server-side | Well. It calls our app, and we call it | Very well | As a separate app only | Very well |
| **Difficulty in 6 h** | Low (TTS) to medium (recording, live captions) | Low to medium | Low | Low separately, high merged | Low to medium |
| **Main risk** | **Free accounts blocked on shared IPs** | A local n8n isn't reachable from a deployed app | Credits during a live demo | It changing the shared database | Unauthenticated limit on venue Wi-Fi |
| **Ready in this repo** | `elevenlabs.ts`, off until a key is set | `n8n.ts`, off until configured | `firecrawl.ts`, off until a key is set | Guidance only | `github.ts` |

---

## ElevenLabs

### Setup and authentication

1. **One** teammate signs up at [elevenlabs.io](https://elevenlabs.io/pricing) (see the IP warning below).
2. Create an API key on the dashboard. Keys can be **restricted to specific endpoints**, given a **credit limit** and limited to IP ranges ([authentication](https://elevenlabs.io/docs/api-reference/authentication)). Allow only text-to-speech, speech-to-text, voices and user read access, and set a credit cap.
3. Set `ELEVENLABS_API_KEY` in `.env.local` (server-only), restart, and press **Speak** on `/dev/integrations`.

Requests send the key in the `xi-api-key` header. The key's format isn't documented, so our checker only requires a plausible length. The secret scanners look for the long-standing `sk_` plus 48 hex shape.

**Browser access without the key:** `POST /v1/single-use-token/{realtime_scribe|batch_scribe|tts_websocket}` returns a token that lasts 15 minutes and works once ([tokens](https://elevenlabs.io/docs/api-reference/tokens/create)). Our `createBrowserToken()` wraps it, for live captions or streaming speech straight from the browser.

### Free plan

From [pricing](https://elevenlabs.io/pricing) and the [429 help page](https://elevenlabs.io/docs/help-center/technical/api-error-code-429):
- **10,000 credits a month**, shared by every product, with no rollover. The pricing table suggests about 10 minutes of speech, but its layout was unclear.
- **2 requests at once** on Free. Our client caps itself at 2.
- **Not for commercial use.** Fine for a hackathon, but credit ElevenLabs in the demo anyway; third parties say Free requires it.
- Library voices are not available through the API on Free. Premade voices, such as our default "George" `JBFqnCBsd6RMkjVDRZzb` from the [quickstart](https://elevenlabs.io/docs/quickstart), are.
- `mp3_44100_192` and 44.1 kHz PCM/WAV need paid plans. Our default is `mp3_44100_128`.
- There's no student programme. The startup grant doesn't fit a hackathon.

**The shared-IP risk.** ElevenLabs can disable Free-tier use when it sees "unusual activity", including another Free account on the same IP: a school, an office, or a venue's Wi-Fi. Its help page says this can't be reversed on a Free account, and that paid accounts aren't flagged ([help article](https://elevenlabs.io/docs/help-center/account/general/what-does-unusual-activity-detected-free-tier-usage-disabled-if-you-are-using-proxy-vpn-you-might-need-to-purchase-a-paid-plan-to-not-trigger-our-abuse-detectors-mean)). To reduce the risk:
- Have one account for the team.
- Make ElevenLabs calls from one machine, ideally on a phone hotspot.
- Ask the sponsor for a code that upgrades the account without a card.

Our client recognises the error and shows "ElevenLabs has paused free-tier use for this account or network".

### API

Base URL `https://api.elevenlabs.io`, header `xi-api-key`.

| Endpoint | Use | In our client |
| --- | --- | --- |
| `POST /v1/text-to-speech/{voice_id}?output_format=…` with `{ text, model_id, voice_settings?, language_code? }` | Text to audio bytes ([reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)). A `/stream` variant also exists | `speak()`, buffered |
| `POST /v1/speech-to-text`, multipart with `model_id`, `file`, `language_code?`, `diarize?` | Audio to `{ text, language_code, words[] }` ([reference](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)) | `transcribe()` |
| `GET /v2/voices?category=premade` | Voices you can use | `listVoices()` |
| `GET /v1/user/subscription` | `character_count` and `character_limit` this period | `getUsage()` |
| `POST /v1/single-use-token/{type}` | Short-lived browser token | `createBrowserToken()` |

**Models** ([models](https://elevenlabs.io/docs/overview/models)):

| Model | Characters per request | Notes |
| --- | --- | --- |
| `eleven_flash_v2_5` | 40,000 | Our default. About 100 ms, 32 languages, half the price of Multilingual v2 |
| `eleven_multilingual_v2` | 10,000 | |
| `eleven_v3` | 5,000 | |
| `eleven_v4` | 10,000 | |

Speech-to-text uses `scribe_v2`, or `scribe_v2_realtime` for live use. `scribe_v1` is deprecated.

The exact credit cost per character on credit plans isn't stated in the model docs. Treat a character as costing up to one credit, and less with Flash.

**Errors** ([errors](https://elevenlabs.io/docs/eleven-api/resources/errors)): `{ "detail": { "code", "message", … } }`.
- 401 is a bad key.
- 402 `insufficient_credits` means out of credits.
- 403 is permissions, or an IP not on the key's allowlist.
- 422 is a validation error.
- 429 `rate_limit_exceeded` or `concurrent_limit_exceeded` means too many requests.

The older codes `quota_exceeded` and `system_busy` are handled too.

### Approach

Everything runs server-side. The browser never sees the key.

- **Speech out:** a route handler calls `getElevenLabs().speak(text)` and returns the bytes with their `Content-Type` (see [integrations.md](integrations.md)). Store generated audio in the user's Storage folder and play it from there, so each text is only paid for once.
- **Speech in:** the browser records with `MediaRecorder`, uploads to Storage (5 MB limit) or straight to a Server Action, and the server calls `transcribe(file)`.
- **Live:** for captions or a voice agent, issue a single-use token from a route and connect from the browser. This is the hardest option; leave it until the basics work.
- **Budget:** our client allows `ELEVENLABS_MAX_CHARACTERS_PER_DAY` (5,000 by default) per server instance, 2 requests at once and 30 a minute. A rejected request gives its characters back.

---

## n8n

### Hosting, without Docker or spending

From [pricing](https://n8n.io/pricing) and the [npm install guide](https://docs.n8n.io/hosting/installation/npm/):
- **There is no free cloud plan.** The Cloud **trial** needs no card. It allows 1,000 executions, 5 at once and a 180-second limit per execution. Its length isn't stated on the pricing page.
- **Self-hosting the Community Edition is free.** Run `npx n8n` with Node 20.19 to 24, **without Docker**. It serves `http://localhost:5678` and stores its data in `~/.n8n` (SQLite). The docs say npm installs are deprecated from n8n 3.0, so check the version.
- **n8n's built-in tunnel needs Docker**, so we don't use it. Never expose a laptop to the internet.
- A local n8n is reachable only from the same machine. Either demo from the laptop running both the app (`npm run dev`) and n8n, or use the Cloud trial for a deployed app.
- There's no official student plan. Ask the sponsor for a Cloud code; past n8n hackathons have given them out.
- The [Community Edition](https://docs.n8n.io/hosting/community-edition-features/) lacks SSO, environments, external secrets and project sharing. None of those matters for a 6-hour build.

### How it connects to our app

- **App to n8n** (`src/lib/integrations/n8n.ts`): the Webhook node uses **Header Auth** with header `X-N8N-Secret` and our `N8N_WEBHOOK_SECRET` as the value ([Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)). Use the **production** URL (`/webhook/…`), which n8n registers when you **publish** the workflow. The test URL (`/webhook-test/…`) only works while the editor is listening, and `/dev/integrations` warns if it is configured. Replies that are plain text, such as "Respond Immediately", are accepted too. `getN8n().trigger(event, payload)` posts `{ event, sentAt, payload }`. It isn't retried, so a workflow never runs twice.
- **Getting results back (preferred):** set the Webhook node to respond with a **Respond to Webhook** node. The result comes back in the same request, and our Server Action saves it as the signed-in user, under RLS. No callback route and no admin key are needed.
- **n8n to the app (only if needed):** an HTTP Request node sends `Authorization: Bearer <N8N_CALLBACK_SECRET>`, and our route checks it with `isAuthorizedN8nCallback(request)`. There is no user session, so a database write needs `createAdminClient()` and careful checks on what is written. Avoid this unless the workflow is long-running.
- **Never give n8n the Supabase secret key.** Its Supabase node needs one ([credentials](https://docs.n8n.io/integrations/builtin/credentials/supabase.md)), and that key bypasses RLS. Have n8n call our app instead.

### Useful nodes

Webhook, Respond to Webhook, HTTP Request, Schedule Trigger, Anthropic (Claude), GitHub, Gmail and Discord are all built in. We found no official ElevenLabs or Firecrawl node. Call their APIs through our app, or through the HTTP Request node with the key kept in n8n credentials.

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
| **Codespaces** | A browser dev environment for a teammate whose laptop fails | 10 min | 120 core-hours a month free, about 60 hours on 2 cores ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)). Everything runs without Docker against the hosted project, so `npm run dev` works there |
| **Pages** | Static hosting for a write-up or landing page | 15 min | Docs conflict about private repos on Free. Assume it needs a public repo |
| **Copilot** | Faster coding | None | Copilot Student is free for verified students |

**GitHub Models is gone.** It was retired on 30 July 2026, including its inference API ([changelog](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)). For AI, use our existing `src/lib/ai` (Anthropic, or the free mock provider).

**On a private repo, GitHub's security features are limited.** Secret scanning, push protection and CodeQL are free only for public repos. Dependabot works on any plan ([features](https://docs.github.com/en/code-security/getting-started/github-security-features)). Keep using `npm run secrets:scan`. If a prize requires a public repo, the history scan is already clean, so making it public is low risk. Run the scan again first anyway.
