# External integrations

`src/lib/integrations` is how the app talks to external APIs, including sponsor technology. Each integration is one server-only file built on a shared HTTP client, so adding a new one takes minutes, not an hour of error handling.

Which sponsors to use, and why, is in [sponsor-strategy.md](sponsor-strategy.md). What each one offers is in [sponsor-comparison.md](sponsor-comparison.md).

## Layout

```
src/lib/rate-limit.ts             In-memory sliding-window limiter (shared with src/lib/ai)
src/lib/integrations/
  env.ts        readIntegrationEnv(): validates server-only variables, never reveals values
  errors.ts     IntegrationError, plus helpers for Server Actions and route handlers
  http.ts       createApiClient(): timeouts, retries, rate limits, concurrency, schema checks
  firecrawl.ts  Optional. Web pages to markdown or structured JSON. Off until FIRECRAWL_API_KEY is set
  github.ts     GitHub REST, public data with no token, plus webhook signature checks
  status.ts     Every integration's state, for /dev/integrations and /dev
```

`/dev/integrations` shows each integration's state and lets you try GitHub and Firecrawl with one click. It never shows a value.

## What every integration gets

| Concern | How `createApiClient` handles it |
| --- | --- |
| Configuration | `readIntegrationEnv` returns `ready`, `off` (not set, which is fine) or `invalid`. It refuses `NEXT_PUBLIC_` copies of a key and placeholder values. |
| Timeouts | Every attempt has one (15 s by default). A caller's `AbortSignal` cancels cleanly. |
| Retries | GET only, by default, on 429, 5xx, timeouts and network errors. Exponential backoff, and `Retry-After` is honoured. A wait over 5 s fails fast with `retryAfterSeconds` instead. POSTs aren't retried, because retrying can do the work, and spend the credit, twice. |
| Rate limits | `rateLimits` stops requests *before* they reach the service, so a loop or an eager demo audience can't burn a free tier. |
| Concurrency | `maxConcurrent` queues extra requests. Firecrawl's free plan allows 2 browsers at once. |
| Responses | A zod `schema` validates every response. Select only the fields you use. |
| Errors | Everything becomes an `IntegrationError` with a `kind`, our own HTTP status and a `userMessage` that is safe to show. |
| Secrets | Values in `secrets` are scrubbed from error text, even if the service echoes them. Absolute URLs are refused, so the auth header can't be sent to another host. |

The limits are per server instance. They are a safety net, not billing control. On Vercel each instance has its own counters.

| `kind` | Our status | Typical cause |
| --- | --- | --- |
| `not_configured` | 503 | The key isn't set |
| `bad_request` | 400 | Bad input, or the service refused it |
| `not_found` | 404 | The thing doesn't exist |
| `unauthorized` | 503 | The server's key was rejected. Not the user's fault |
| `quota_exceeded` | 503 | Out of free credits (HTTP 402) |
| `rate_limited` | 429 | Our limit or theirs. `retryAfterSeconds` when known |
| `timeout` | 504 | Took too long |
| `cancelled` | 499 | The caller aborted |
| `upstream` | 502 | The service is failing (5xx) |
| `invalid_response` | 502 | The response didn't match the schema |
| `network` | 502 | Couldn't connect |

## Add an integration in about 15 minutes

Copy `src/lib/integrations/github.ts` as the starting point.

1. **Declare its variables.** Server-only names, never `NEXT_PUBLIC_`:

   ```ts
   export const ACME_ENV = {
     apiKey: { name: "ACME_API_KEY", pattern: /^acme_/, hint: "start with acme_" },
   } as const;
   ```

2. **Create the client** with the service's free-tier limits:

   ```ts
   export function createAcmeClient(config: { apiKey: string } & Pick<ApiClientOptions, "fetch" | "sleep">) {
     const api = createApiClient({
       integration: "Acme",
       baseUrl: "https://api.acme.example/v1",
       headers: { Authorization: `Bearer ${config.apiKey}` },
       secrets: [config.apiKey],
       timeoutMs: 15_000,
       rateLimits: [{ limit: 30, windowMs: 60_000 }],
       maxConcurrent: 5,
       fetch: config.fetch,
       sleep: config.sleep,
     });
     return {
       getThing: (id: string) =>
         api.request({ path: `/things/${encodeURIComponent(id)}`, schema: thingSchema }),
     };
   }
   ```

3. **Add a cached getter** that throws `not_configured` while the key is unset, and a status function. Copy `getFirecrawl` and `firecrawlStatus`. Keeping one client per process is what makes the rate limits work across requests.
4. **Register it** in `status.ts`. It then appears on `/dev/integrations` and in the `/dev` status check.
5. **Document the variables** in `.env.example` (commented out), add the key's format to `scripts/scan-secrets.mjs`, and add the name to `scripts/check-client-bundle.mjs`.
6. **Test it** with a fake `fetch`, as in `tests/unit/integrations.test.ts`. That needs no network and costs nothing.

## Using an integration

### From a Server Action (preferred)

```ts
"use server";
import { integrationErrorMessage } from "@/lib/integrations/errors";
import { getFirecrawl } from "@/lib/integrations/firecrawl";
import { createRateLimiter } from "@/lib/rate-limit";
import { requireUser } from "@/lib/supabase/auth";

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

export async function summarisePage(url: string) {
  const user = await requireUser();
  if (!limiter.check(user.id).allowed) return { ok: false as const, message: "Slow down a little." };
  try {
    const page = await getFirecrawl().scrape(url);
    return { ok: true as const, title: page.title ?? "Untitled" };
  } catch (error) {
    return { ok: false as const, message: integrationErrorMessage(error) };
  }
}
```

### From a route handler

Use this when something other than our own pages calls it, such as a Lovable app or a webhook:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { integrationErrorResponse } from "@/lib/integrations/errors";
import { getGitHub } from "@/lib/integrations/github";
import { getCurrentUser } from "@/lib/supabase/auth";

const input = z.object({ repo: z.string().min(3).max(200) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json(await getGitHub().getRepository(parsed.data.repo));
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
```

### Receiving GitHub webhooks

```ts
import { verifyWebhookSignature } from "@/lib/integrations/github";

export async function POST(request: Request) {
  const body = await request.text(); // The raw body. Verify before parsing.
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!verifyWebhookSignature(body, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Invalid signature", { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(body);
  // Store what you need in Supabase, then let Realtime update the UI.
  return new Response(null, { status: 204 });
}
```

Webhooks need a public URL, so deploy first (see [deployment.md](deployment.md)). Never expose the local machine to the internet for this.

## Rules

- **Server-only.** Integration modules import `server-only`, and keys never get a `NEXT_PUBLIC_` prefix. `npm run check:bundle` fails if a key, or a key's variable name, reaches browser JavaScript.
- **Cache results in Supabase** when they will be shown more than once. A stored scrape costs nothing the second time, and the demo keeps working if the service is slow or out of credit.
- **Budget the free tier.** Set `rateLimits` from the provider's published limits, and keep a daily cap (see `FIRECRAWL_MAX_REQUESTS_PER_DAY`).
- **Always have a fallback for the demo.** Use cached rows, or a mock, as `AI_PROVIDER=mock` does for AI.
- **Tests never spend.** Unit tests use a fake `fetch`. The E2E servers blank every integration variable, so keys in `.env.local` are never used by tests.
