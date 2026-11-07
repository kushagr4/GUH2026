# EmberGap API ownership and implementation checklist

**Hackathon MVP, November 2026.** This is the authoritative assignment of every external integration and internal HTTP API. It documents *planned work*, not implemented functionality. The team is **Claude Mac, Claude PC, Danil, Outrolife, d3vmakes**. No one is assigned another person's endpoints. Start with labelled deterministic synthetic fixtures; live APIs are optional enrichment.

## Exact API ownership

| Who | External service and exact upstream API | Credentials | Internal module / endpoint owned | Concrete output |
| --- | --- | --- | --- | --- |
| **Outrolife** | **NASA FIRMS Area API**, `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{BBOX}/{DAYS}` with a documented VIIRS NRT source, bounded area and day range | `NASA_FIRMS_MAP_KEY` (server-only, obtained via NASA FIRMS) | `src/lib/embergap/sources/firms/**`; **GET `/api/embergap/map`**; **GET `/api/embergap/investigations/[id]`** | FIRMS observations normalized with coordinates, acquired time, satellite/sensor/source, retrieval time, limitations; viewport-bounded public-safe map features and authorised investigation details for the map/dashboard |
| **Claude PC** | **Open-Meteo Forecast API**, `https://api.open-meteo.com/v1/forecast` (`latitude`, `longitude`, `current` or `hourly` for `temperature_2m`, `relative_humidity_2m`, `precipitation`, `wind_speed_10m`, `wind_direction_10m`) | No key for qualifying free use (verify usage/licensing conditions) | `src/lib/embergap/sources/weather/**` | Structured weather context with forecast-vs-observation distinction, UTC time, units, source freshness and unknown-data states |
| **Claude PC** | **NASA EONET v3 events**, `https://eonet.gsfc.nasa.gov/api/v3/events` and `https://eonet.gsfc.nasa.gov/api/v3/categories`; filter by the **wildfires** category identifier from current docs and relevant spatial/temporal bounds | No key for public API | `src/lib/embergap/sources/eonet/**` | Contextual existing event records with IDs, geometry/time, provenance and retrieval time; an absent match is **not** evidence that no fire exists |
| **Danil** | **Anthropic Messages / Vision API**, `POST https://api.anthropic.com/v1/messages` through existing `@anthropic-ai/sdk` / repo AI provider (not raw browser calls) | Existing `ANTHROPIC_API_KEY` (server-only) | `src/lib/embergap/agents/validators/vision/**`, `witness/**`, `src/lib/embergap/agents/fusion/**` | Validated structured descriptions of photo content and uncertainty; witness correlation without double-counting duplicate reports; explainable, review-priority fusion findings |
| **Claude Mac** | **Supabase Auth, Database, private Storage and Realtime** using existing installed `@supabase/ssr` and `@supabase/supabase-js` helpers (not custom unauthenticated admin endpoints) | Existing publishable Supabase values; no new hosted secret sharing | `src/lib/embergap/contracts.ts`, `src/features/embergap/**`, **POST `/api/embergap/reports`**, additive `supabase/migrations/**`, generated types | Authenticated, rate-limited, Zod-validated report creation, optional private media reference/upload path, initial investigation event, and read-only repository functions consumable by Outrolife |
| **d3vmakes** | **No external API credentials or server endpoints**. Consume the Mac-owned report POST API. | No secrets in browser | `src/components/embergap/report/**`, `src/app/app/embergap/report/**` | Safe, accessible approximate-location + timestamp + description + optional image report UI; graceful loading/errors; mock submission until Mac backend lands |
| **Claude PC** | **No additional external service** for runtime; in-process or local-worker messaging | None | `src/lib/embergap/agents/runtime/**` | Independent workers with inbox/outbox, delays, partitions, locally processed tasks, unique event IDs, deduplication and eventual reconciliation |

**Avoid duplicate API work:** Outrolife alone implements FIRMS and the two GET routes. Claude Mac alone implements the POST report route, persistence interfaces and schema. PC alone implements Open-Meteo/EONET and worker transport. Danil alone implements Anthropic vision/witness/fusion. d3vmakes owns the browser form and no server routes.

## Internal route contract: ownership and initial behavior

### 1. `POST /api/embergap/reports` (Claude Mac)

Authentication: required. Request: approximate latitude/longitude, `observedAt` UTC timestamp, bounded `description`, optional *private owner-scoped* media reference. Check content type, body sizes and rate limits. Response (canonical shared Zod schema to be published by Mac):

```json
{"reportId":"uuid","investigationId":"uuid","status":"unreviewed"}
```

This is an **illustrative shape**, not an already deployed endpoint. The browser form must not upload private image content to a public bucket. Upload permissions are authenticated and scoped to the reporter. Creating a report does not dispatch emergency services or declare a fire.

### 2. `GET /api/embergap/map?bbox=minLon,minLat,maxLon,maxLat&limit=50` (Outrolife)

Authentication / access: apply the server's deliberate permission model. Return **only approved public-safe synthetic or consent-appropriate map projections**, not exact reporter locations, identities, private media or raw unmoderated reports. Validate bounding box, limit, and coordinate order. Use fixture mode immediately; when Mac's repository functions land, consume those without rewriting the database access layer.

Example map feature: `{id, approximateLocation, kind, observedAt, ingestedAt, source, freshness, reviewStatus, synthetic}`. Reconcile field names to Mac's canonical contract; never invent a separate incompatible exported schema. FIRMS observations may be shown as thermal anomalies, not confirmed wildfire pins.

### 3. `GET /api/embergap/investigations/[id]` (Outrolife)

Requires authenticated and **authorised** report owner/reviewer. Return an investigation's status, timestamps, evidence citations, reason codes, limitations and agent event history without leaking another person's report. 404 on inaccessible/nonexistent IDs; never use a privileged client to bypass ownership. Build fixture-mode detail display now; wire to Mac's repository layer after it lands.

### 4. Internal worker invocation (Claude PC, coordinated with Mac/Danil)

Do **not** invent an unauthenticated public `/api/run-agents` or an always-on worker endpoint exposed over the internet. Define a typed task/event interface for a deterministic local demo driver, plus server-only invocation if integration demands it. Only Mac wires trusted report submission to runtime scheduling. Outrolife can display status via its authorised GET APIs, not issue privileged agent commands from the browser.


**On Vercel** there are no long-lived workers. The report route starts each investigation run with `scheduleInvestigation()` (`src/features/embergap/orchestrator.ts`, using `after()` and `maxDuration = 60`). Claude PC's runtime plugs in as an `InvestigationRunner`, writes through `EmberGapRuntimeStore`, and keeps partitions and delays as a deterministic simulation within one run. See `docs/architecture.md#agent-runtime-on-vercel`.
## Environment variables and safety

| Environment variable | Owner | Availability |
| --- | --- | --- |
| `NASA_FIRMS_MAP_KEY` | Outrolife prepares adapter; developer holding credentials supplies key server-side | Optional to run live FIRMS; fixture mode works without |
| `ANTHROPIC_API_KEY` | Danil integrates with existing AI provider; key provided securely | Optional for live Vision; mocked responses work without |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Claude Mac reuses existing project config | The existing hosted project's public values, in `.env.local` and in Vercel (no Docker) |
| `SUPABASE_SECRET_KEY` | Claude Mac (agent runs) | Server-only, Vercel and the migration owner's machine only. Agent workers use it to record findings; never shared with teammates |
| Open-Meteo / EONET | Claude PC | No keys typically required for public endpoints, subject to current provider terms |
| Map tiles | Outrolife | Use a licensed provider; configure any key according to its public/private restrictions |

Store only **placeholder keys** in `.env.example`. Never print, commit or expose real credentials to the browser. Use existing `createApiClient` patterns, Zod validation, timeouts, bounded retries, throttling, caching and explicit `unavailable`/stale states. Live API calls must not run in CI unit tests.

## In-practice first commits

1. **Mac**: publish `contracts.ts` and relevant Zod schemas, plus a stub read repository interface. Show teammates exact exported symbols and JSON response types. Then implement migration, report backend and upload policies.
2. **Outrolife**: implement FIRMS normalization against saved fixture CSV and **working fixture-backed GET map/detail routes**, then map/dashboard UI. Do not wait for the migration or credentials. Integrate with Mac-owned repository interface later.
3. **PC**: implement Open-Meteo and EONET adapters with deterministic response fixtures and test normalization, then a small independent-message agent runtime with a partition test. Do not work on FIRMS.
4. **Danil**: implement pure witness and vision validation, mocked Anthropic responses, and explainable evidence fusion; connect to PC's typed agent task interface later.
5. **d3vmakes**: implement report UI against a local mock POST response; once Mac's API exists, replace the mock with the canonical authenticated call. Execute one 10-15 minute internal demo walkthrough only.

## Minimum demonstration

Show: (1) a synthetic eyewitness report, (2) independently sourced evidence from fixture/live adapters, (3) Danil's traceable corroboration and limitations, (4) a network partition in PC's runtime with **work done while disconnected**, (5) reconnection with no duplicated records, and (6) Outrolife's investigation map panel. Keep metrics grounded in synthetic experiment results. No public safety warnings, auto dispatch or fabricated confirmation.

## PR and verification policy during hackathon

No mandatory Claude self-review, `/code-review`, reviewer agents, review markers or human approval. Open feature PRs after focused implementation checks. Continue work while CI runs, but do not claim unexecuted tests passed. The human owner handles PR merges; Claude never merges or pushes to `main`. Preserve secrets scanning, RLS, private media, input validation and independent agent correctness tests.
