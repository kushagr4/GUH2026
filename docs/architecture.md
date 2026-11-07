# Architecture

This document describes the existing GUH2026 infrastructure first and the planned EmberGap product architecture in the second section. Planned components are not yet implemented.

## Overview

```
 Each developer laptop                               Supabase Cloud (free plan)
┌──────────────────────────────────────────┐        ┌──────────────────────────┐
│ npm run local:dev                        │        │ Hosted project, for the  │
│  Next.js (localhost:3000)                │        │ deployed demo only       │
│   ├─ browser client ─┐ publishable key   │        │  Auth, Postgres (RLS),   │
│   ├─ server client ──┤ + user session    │        │  Storage, Realtime       │
│   └─ proxy.ts        ▼                   │        └────────────▲─────────────┘
│  Supabase CLI stack in Docker            │                     │
│   (127.0.0.1:54321) Auth, Postgres (RLS),│   Migration owner,  │
│   Storage, Realtime, REST, Studio        │   from main only:   │
│   built from supabase/migrations/        │   npm run db:push ──┘
└──────────────────────────────────────────┘
```

Every developer runs their own Next.js server and their own Supabase, so neither frontend work nor data can disturb anyone else. Migrations in Git are the shared truth: they build every local database, and the owner applies them to the hosted project, as described in [team-workflow.md](team-workflow.md).

## Why these decisions

| Decision | Reason |
| --- | --- |
| Local Supabase per developer, via the CLI's own Docker stack | No shared keys to hand out, no rate limits or shared data to trip over, and one command to set up. No Compose file to maintain |
| One hosted project on the free plan, for the demo | The team's budget. Only the migration owner changes it |
| CLI `db push` for migrations, MCP read-only | One write path keeps the migration history correct |
| Next.js proxy protects all of `/app/*` | New pages are secure by default, with no list to maintain |
| Password auth, with "Confirm email" off | The built-in mailer is too restricted to rely on in a demo |
| Profiles created on first save | Avoids a trigger on `auth.users`, so no `SECURITY DEFINER` is needed |
| Browser uploads straight to Storage | Bucket RLS and limits apply, and no file passes through the server |
| System fonts | No network dependency at build time on venue Wi-Fi |

## Request flow

1. `src/proxy.ts` runs on every non-asset request. It refreshes the session cookie with `getClaims()`, returns 404 for `/dev/*` when dev tools are off, and redirects signed-out visitors away from `/app/*`.
2. Pages and layouts call `requireUser()` or `getCurrentUser()`, which verify the token and are cached per request.
3. Data access uses `createClient()` from `lib/supabase/server.ts`, acting as the signed-in user. **RLS is the real security boundary**, and the proxy and page checks are for user experience.

## Supabase clients

| File | Where | Identity |
| --- | --- | --- |
| `lib/supabase/client.ts` | Browser | Signed-in user, publishable key |
| `lib/supabase/server.ts` | Server Components, Actions, Route Handlers | Signed-in user, publishable key |
| `lib/supabase/proxy.ts` | Proxy only | Refreshes the session |
| `lib/supabase/admin.ts` | Server only, currently unused | **Bypasses RLS.** Secret key |

## Security layers

| Layer | Protects against |
| --- | --- |
| Explicit `GRANT`s, nothing to `anon` | Anonymous API access |
| RLS with owner policies | One user reaching another's rows |
| Storage policies by `<user id>/` folder | One user reaching another's files |
| Bucket size and type limits | Quota exhaustion and hosted script files |
| `server-only` imports, `scripts/check-client-bundle.mjs` | Secrets in browser code |
| `isPrivilegedKey` in `lib/env.ts` | A secret key pasted into the public variable |
| `safeRedirectPath` | Open redirects |
| `scripts/check-migrations.mjs` | Insecure or destructive SQL reaching review |
| `scripts/scan-secrets.mjs` | Credentials in files or Git history |

## Testing strategy

| Layer | Where | Needs | What it proves |
| --- | --- | --- | --- |
| Unit | `tests/unit` | Nothing | Logic, with Supabase and the network mocked |
| Integration | `tests/integration` | `.env.test.local` with the public values | Real RLS, auth, storage and Realtime boundaries |
| E2E smoke | `e2e/smoke.spec.ts` | Nothing (builds the app) | Pages, redirects, headers, production gate |
| E2E hosted | `e2e/hosted.spec.ts` | `.env.test.local` with the public values | The whole journey in a real browser |

The free-plan constraint means there is one project, so there is no separate test environment. Hosted tests stay safe because they:

- only run with `SUPABASE_TEST_*`, never from a normal `.env.local`
- sign up disposable users named `guh-test+<uuid>@example.test`, through the same public API as real visitors
- touch only rows and files those users own, which RLS enforces
- need no privileged key, so they can't reach anyone else's data even if a test is wrong
- leave only empty accounts behind, cleared with `npm run db:sweep-tests`, which matches that exact email pattern

## AI utilities

`src/lib/ai` exposes one small interface, `AiProvider`, with `streamText`, `generateText` and `generateObject`.

- **Anthropic provider:** the default when `ANTHROPIC_API_KEY` is set. Uses `claude-opus-5-5` with adaptive thinking and streaming. Server-side refusal fallback is on, so a safety decline re-runs on Anthropic's recommended fallback model rather than dead-ending. Change the model and effort with `AI_MODEL` and `AI_EFFORT`.
- **Mock provider:** `AI_PROVIDER=mock`. Offline, deterministic and free. Useful for UI work, tests and as a demo safety net if the network or API fails.
- `/api/ai/chat` requires a session, validates its input, and rate limits to 20 requests a minute per user on each server instance. That is a safety net rather than a billing control, so also set a spending limit in the Anthropic Console.

To add another provider, implement `AiProvider` in `src/lib/ai/providers/` and select it in `src/lib/ai/index.ts`.


---

# EmberGap product architecture (GreatUniHack 2026)

> **Status:** implementation specification, not evidence that the product features have already been built. This section extends the existing starter architecture above. `src/features/account`, `/dev`, and the existing auth/AI/storage infrastructure remain intact until a reviewed PR replaces or extends them.

## Product mission and scientific boundaries

EmberGap is an **investigative wildfire-evidence coordination prototype**, not an emergency dispatch, fire-confirmation, or life-safety warning service. It allows a person to report a possible wildfire from a safe location, then allows independent software agents to assess separately sourced observations (submitted photo/text, satellite thermal anomalies, local weather, nearby independently corroborated reports). Their findings are reconciled into a transparent investigation for **human review**.

- Human reports are unverified *claims*, not incident confirmations. Never instruct someone to approach a fire or gather more evidence in a dangerous location. Display advice to contact local emergency services for immediate danger; filing a report here is not contacting those services.
- NASA FIRMS thermal detections are observations, not definitive fire confirmations. **A missing or delayed satellite detection must never count as proof that no fire exists.** Represent observation age, coverage and availability explicitly.
- Weather can provide context but cannot verify a wildfire by itself. EONET is contextual event information, not a complete live alert registry. An LLM cannot independently establish an image's location, timestamp, authenticity or the existence of a fire.
- Use clear outcome labels such as `unreviewed`, `investigating`, `needs_human_review`, `insufficient_evidence`, and `reviewed`. Separate **evidence strength** from **incident confirmation**. Only an authorised human may update a review decision, and even that is not a governmental fire confirmation.
- Use synthetic locations, reports, satellite responses and photographs for the default demo. Label them clearly. Real-data mode must show source attribution, freshness and missing-data limits, without pretending to be real-time emergency intelligence.

## User journey (MVP)

1. A signed-in reporter selects an **approximate** location, observation time, description and optional photograph. The UI reminds them not to put themselves at risk. A report is stored with a stable ID and privacy protections.
2. The backend creates a linked investigation with an append-only event, queues an assessment task and returns its status. A user cannot write an agent finding or impersonate a trusted reviewer.
3. Independent workers take available evidence, each produce source-attributed, time-stamped findings, and exchange **messages**, not direct access to one another's private state.
4. The evidence-fusion worker reads available findings, identifies contradictions, data gaps and possible duplicates, and produces a review-priority *recommendation* with a transparent explanation.
5. The investigation dashboard shows the report (with safe location precision), agent activity, sources, age of evidence, unknowns, progress during an artificial communications partition and eventual reconciliation.
6. A human reviewer may annotate an investigation with an auditable outcome; there is no automated fire dispatch, public evacuation decision or external safety alert.

## Logical components and ownership

```text
Browser (Developer C: UI/QA)
  report form | interactive map | evidence drawer | agent/network timeline
       | authenticated, validated, rate-limited app interfaces
       v
Next.js app (Claude Mac: core integration)
  src/app/api/embergap/**      thin route handlers
  src/features/embergap/**     actions, repository, report/upload logic
  Supabase Auth + Postgres RLS + private Storage + Realtime
       | versioned task/outbox events
       v
Agent runtime (Developer A: messaging / isolation)
  independent queues, state, decisions and message transport
       |                  |                          |
       v                  v                          v
NASA / weather adapters   Vision/witness validators    Evidence-fusion worker
(Claude PC)               (Developer B)                (Developer B)
FIRMS, Open-Meteo,        Claude Vision, independent    evidence audit,
EONET, fixtures           report clustering            contradictions, status
       \____________________|__________________________/
                            |
                     append-only agent findings
                            |
                    human-review dashboard
```

**Boundary rule:** The browser and Supabase are persistence/presentation/control-plane facilities, **not a hidden central decision engine**. Workers independently own their queues, retry decisions and local evidence snapshots. During a simulated partition, the transport blocks selected inter-worker messages; it must not freeze all processing or secretly inject decisions from the UI. Demonstrate *actual* local progress while disconnected.

For the hackathon, isolated Node.js workers with in-memory local queues and a controlled message bus are sufficient; a multi-machine or production-grade peer-to-peer network is **not** required. Describe the work honestly as a partitionable distributed-agent **simulation**, not as a deployed resilient emergency infrastructure system.

## Proposed file boundaries (new, not yet implemented)

| Owner | Primary owned paths | Contract with other workstreams |
| --- | --- | --- |
| Claude Mac / integrator | `src/lib/embergap/contracts.ts`, `src/features/embergap/**`, `src/app/api/embergap/**`, additive `supabase/migrations/**`, `src/lib/supabase/types*` | Publishes shared types, secure reporting API and persistence. **Only this owner edits shared contracts, migrations and DB types.** |
| Claude PC / external data | `src/lib/embergap/sources/**`, `tests/unit/embergap-sources/**` | Implements `ObservationSource` adapters and deterministic fixtures; does not change migrations, contracts or `.env.local` for others. |
| Developer A / agent runtime | `src/lib/embergap/agents/runtime/**`, `tests/unit/embergap-runtime/**` | Own queues, worker lifecycle, transport, disconnections, event deduplication and reconciliation. |
| Developer B / AI and fusion | `src/lib/embergap/agents/validators/**`, `src/lib/embergap/agents/fusion/**`, corresponding unit tests | Validation findings, duplicate-witness safeguards, evidence-fusion rules, Claude Vision adapter. Integrate through the runtime interface, not direct DB writes. |
| Developer C / UI and QA | `src/components/embergap/**`, `src/app/app/embergap/**`, `e2e/embergap*.spec.ts` | Build UI against contract-compliant fixtures first, then wire to reviewed endpoints. Request approval before changing shared navigation or layout. |

Paths are **proposed ownership conventions**, not an instruction to create every directory immediately. Keep existing repo architecture: thin routes in `src/app`, features in `src/features`, reusable UI in `src/components`, external integration calls through the existing `createApiClient`, and schema truth in SQL migrations. Preserve current `src/lib/ai` provider interface for AI usage.

### Contract-first collaboration

Claude Mac should land a small, self-contained **contracts PR first**. The other four contributors may work concurrently with fixtures but must not silently invent incompatible data shapes. Prefer exported discriminated unions and Zod schemas where they cross external or user input boundaries. Proposed minimal payloads:

```ts
type SourceKind = "human" | "firms" | "eonet" | "weather" | "vision";
type AgentId = "vision" | "satellite" | "weather" | "witness" | "fusion";
type SourceState = "available" | "stale" | "unavailable" | "not_observed";
type InvestigationStatus =
  | "unreviewed" | "investigating" | "needs_human_review"
  | "insufficient_evidence" | "reviewed";

type Observation = {
  id: string; source: SourceKind; sourceRecordId?: string;
  observedAt: string; ingestedAt: string; latitude?: number;
  longitude?: number; sourceState: SourceState;
  evidence: Record<string, unknown>; // source-specific, validated at boundary
};
type AgentFinding = {
  id: string; investigationId: string; agentId: AgentId;
  createdAt: string; evidenceIds: string[];
  assessment: "supports" | "contradicts" | "inconclusive";
  reasonCodes: string[]; explanation: string;
  limitations: string[];
};
type AgentMessage = {
  id: string; investigationId: string; from: AgentId;
  to: AgentId; kind: string; createdAt: string;
  correlationId: string; payload: unknown; // validated by kind
};
```

These are **illustrative target interfaces** until Claude Mac commits real schemas; production code must validate `evidence` and `payload` rather than trust `unknown`. Use UTC ISO timestamps, stable UUID-like event IDs, explicit coordinates order (`latitude` then `longitude`), and explicit missing values. Never encode missing data as zero confidence or as negative evidence. Define an explicit version field for any persisted message schema.

## Data architecture (proposed migrations, not yet present)

- `reports`: owner ID, approximate coordinates, observed time, description, optional private media reference, moderation/investigation status, created time.
- `report_media`: owner-scoped private object path, MIME type, size, metadata handling.
- `investigations`: linked reports, current lifecycle, reviewer annotations and derived progress (not fabricated truth).
- `observations`: original source, source record ID, observation time, ingestion time, spatial data, source availability, provenance and TTL/freshness.
- `agent_findings`: append-only independent assessments, evidence links, limitations and reason codes.
- `agent_events`: append-only queued, delivered, reconciled and partition events with idempotency keys.

Each new exposed table needs explicit grants, RLS, scope-specific owner/reviewer policies and tests. Do **not** simply allow all authenticated users to read other users' private reports or photos. Reporter-only access is the default, and authorised reviewers need a *separately justified, server-checked* access model. Do not grant arbitrary role elevation based on user-editable metadata. The current repo uses `(select auth.uid())` and `to authenticated`, with access still restricted by ownership. Storage remains private and user-scoped. If PostGIS is used, validate extension/migration support first; no extension should be assumed to be present.

Do not expose exact reporter locations, photo GPS EXIF or private identities through the public map. Strip unnecessary photo metadata, set size/type limits, prevent mass scraping, rate-limit submissions and implement moderation/abuse controls before any public real-data mode. Never publish raw human reports as verified events.

## API adapters and keys

- **NASA FIRMS**: server-only `NASA_FIRMS_MAP_KEY`; query time/bounds; preserve sensor, original coordinates, observation timestamps, retrieval timestamps and API failures. Distinguish thermal anomalies from confirmed fires.
- **Open-Meteo**: weather and relevant observation/forecast context; preserve whether a reading is observed, modelled or forecast, with timestamps. Check free-use/licence terms before deployment.
- **NASA EONET v3**: contextual natural-event records with their age/coverage. Do not confuse a lack of event records with a negative observation.
- **Claude Vision**: existing server-only `ANTHROPIC_API_KEY` through the repo AI facilities; ask for structured, cautious findings and validate output. Never claim image authenticity, time or location from model judgement alone.
- **OpenAQ**: optional only, once core flow works. Geographic station coverage is uneven; preserve station location and measurement age.
- **MapLibre**: optional UI map renderer, plus a properly licensed tile provider. Treat maps as presentation, not fire confirmation.

Before coding adapters, verify current API endpoints, auth, rate limits and response schemas against official docs. Use `createApiClient` with bounded timeouts, controlled retries, error mapping, caching and budgets. Mock all network calls in unit tests; never spend API credits in CI. Do not add secrets to `NEXT_PUBLIC_*`, logs, PRs or screenshots.

## Agent lifecycle and partition tests

1. Report created -> durable event with a stable ID -> relevant agent task(s).
2. Each worker consumes its local queue and produces append-only findings, with source references and timestamps.
3. Message transport simulates independent link delay, loss, duplication and partitions. An isolated worker still processes tasks already locally available and records outputs to its local queue.
4. Reconnection exchanges missing events using stable event IDs, idempotent merge and recorded reconciliation decisions. Never overwrite contradictory evidence without an audit trail.
5. Fusion updates recommendations only when newly available evidence warrants it and explains why. Unknown/stale evidence remains visible.
6. Benchmark on deterministic synthetic scenarios: genuine source evidence, misleading smoke/photo, missing FIRMS pass, API timeout, repeated witness, duplicate message, out-of-order messages, offline agent and restored partition.

**Required measurable demo:** work completed while isolated; no lost or double-applied events; convergence after reconnection; evidence-source attribution; time to analysis and false-positive/false-negative behaviour on **labelled synthetic ground truth**. Do not invent comparative improvement percentages. Compare to a clearly defined single-source or centralised baseline on the same fixture, not a deliberately broken strawman.

## Security and safety gates

- Human reports may be inaccurate, malicious or privacy-sensitive. Treat free text, EXIF, AI output and API results as untrusted. Rate-limit, authenticate, validate, sanitise, moderate and minimise retention.
- No automatic emergency-service dispatch, evacuation advice, tactical wildfire-spread instructions, public incident confirmations or emergency decision automation.
- AI image interpretation is only supporting evidence; deterministic checks and human review determine how evidence is presented. Never silently convert model guesses into facts.
- Do not infer a precise location from an image or display a reporter's exact coordinates publicly.
- All secrets stay server-side. Respect the existing `CLAUDE.md` prohibitions on hosted resets, remote credentials, merging and direct `main` pushes.
- Local development: `npm ci && npm run local:dev`; each developer runs their own Docker-backed local Supabase. Only the migration owner deploys to hosted after reviewed PRs.
- The default demo must work **fully offline from third-party AI/data APIs** through clearly labelled synthetic fixtures. Make live mode opt-in with honest failures, rather than fabricating API responses.

## Test and delivery checklist

- Unit tests: light-curve is not relevant; test observation normalization, duplicate detection, task arbitration, bad/stale/missing sources, agent state, partition recovery and merge idempotency.
- Integration: scoped report visibility, private uploads, agent findings access controls, new table grants/RLS and migration correctness on local Supabase.
- E2E: report form validation, photo handling, map evidence drawer, review explanation, empty/error states and simulated partition controls, desktop and narrow mobile width.
- Existing commands: `npm run preflight`, `npm run validate`, `npm run local:status`, `npm run local:test`. Run targeted tests first; note anything skipped.
- PR order: **contracts and migrations -> independent source/runtime/validation/UI PRs -> integration PR -> demo hardening**. Avoid cherry-picking unreviewed work across branches.
- Owner coordinates one human approval per PR. Claude Code sessions never approve, merge or push to `main`. Existing `/feature-dev`, `/bugfix`, `/self-review` skills remain mandatory for the relevant phases.
