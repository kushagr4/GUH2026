# EmberGap data adapters and agent runtime (Claude PC)

Open-Meteo and NASA EONET adapters, and the runtime that lets independent agents keep working through a network partition and reconcile afterwards. Everything is server-side, needs no keys, and runs on Vercel functions: no Docker, no background processes, no filesystem. It's a **deterministic, single-process simulation of a partitionable agent network**, not a deployed multi-machine system.

## Files

| Path | What it is |
| --- | --- |
| `src/lib/embergap/sources/weather/` | Open-Meteo Forecast API client, normalisation, canonical mapping, synthetic fixtures |
| `src/lib/embergap/sources/eonet/` | NASA EONET v3 client, normalisation, canonical mapping, synthetic fixtures |
| `src/lib/embergap/agents/runtime/` | Agents, simulated network, simulation driver, in-memory store, the partition demo. Import from `@/lib/embergap/agents/runtime` |
| `tests/unit/embergap-sources/`, `tests/unit/embergap-runtime/` | Unit tests, with no network |

## Source adapters

Both implement the contract's `SourceAdapter` port. They return canonical `Observation[]` plus `SourceAvailability`, and never throw: a failure is an `unavailable` observation with a safe message.

```ts
import { createOpenMeteoSourceAdapter } from "@/lib/embergap/sources/weather/open-meteo";
import { createEonetSourceAdapter } from "@/lib/embergap/sources/eonet/eonet";

const subject = taskSubjectFor(report, scenarioId); // Mac's helper: public location and time
const checkedAt = new Date().toISOString();
const weather = await createOpenMeteoSourceAdapter()({ investigationId, subject, checkedAt });
const eonet = await createEonetSourceAdapter()({ investigationId, subject, checkedAt });
```

- **Open-Meteo has no station observations.** Every value is weather-model output, so readings are labelled `modelled` or `forecast`, never `observed`. The adapter emits the hourly reading nearest the report time, with the contract's 24-hour rain total (null unless all 24 hours exist). It sends `timeformat=unixtime` and `timezone=GMT`, rounds the point to about 1 km (Open-Meteo logs query coordinates for 90 days), and keeps nulls as missing data. Data is CC BY 4.0: show "Weather data by Open-Meteo.com" with a link wherever it appears (the provenance carries it).
- **EONET is curated event metadata, not detection.** It only holds fires of about 500 acres or more, isn't exhaustive, and its time of day is unreliable, so dates are matched at day precision. No match is `not_observed` with the checked window, never "no fire". The query hard-codes `category=wildfires` and `status=all`, uses EONET's bbox order (min_lon,max_lat,max_lon,min_lat), and looks 60 days back, because EONET only returns records whose own date is inside the window. Titles with Rx are flagged as likely prescribed burns.
- **Budgets** sit far below the providers' published limits, because Vercel functions share outbound IPs: Open-Meteo 60 calls a minute and 1,000 a day, EONET 30 a minute. Results are cached per server instance (15 and 10 minutes), and caller copies can't alter the cache.

## How the runtime works

- **Agents** (`weather`, `satellite`, `vision`, `fusion`) each own a private task queue, inbox, per-peer outbox and replica of the event history. They share nothing but the network. The weather agent also carries EONET context, because the contract has no EONET agent.
- **Messages:** an agent pushes its own new events once to the peers it believes reachable, and every second exchanges a digest with every peer. Each side sends what the other lacks (push-pull anti-entropy), which also relays events around a cut link. Each event has a unique id (`<runId>:<origin>:<seq>`) and a content hash, is validated with the contract's schemas, and is applied once. A duplicate is counted and ignored. A second version of the same id is a recorded conflict, and every replica keeps the lowest hash.
- **Reachability** comes only from what an agent hears: a peer is unreachable after three seconds of silence. A partition cuts links. It never pauses agents.
- **Tasks** come from each agent's own feed. A task can wait for other tasks (`after`): it runs only once each one's outcome event, and everything that outcome produced, is held locally. Work that needs evidence from across a partition waits for it instead of guessing. A failed task still emits an outcome, so dependants see "unavailable" rather than waiting forever.
- **Processors** are the plug-in point. They are synchronous and pure, so all I/O happens before a task is enqueued, and they return canonical observations plus finding drafts. The runtime adds ids, attribution and time, then validates everything with `observationSchema` and `agentFindingSchema`. The contract's scientific rules hold for anything that replicates.
- **Persistence:** each agent writes its own records through `EmberGapRuntimeStore`. The driver, as the contract's `system` endpoint, records `partition_started`, `partition_healed` and `reconciled` (with `redelivered`, `duplicatesIgnored` and `completedWhileIsolated`) for each in-flight investigation.

## Invoking it from the deployed Next.js backend (Claude Mac)

A run is one short call: the demo takes about 0.1 s of wall time for about 14 s of simulated time, and returns about 50 KB of JSON. Run it from trusted server code with the service-role store. Don't add a public, unauthenticated route (see `docs/embergap-api-ownership.md`).

```ts
"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseRuntimeStore } from "@/features/embergap/runtime";
import { runPartitionDemo } from "@/lib/embergap/agents/runtime";

export async function runEmbergapPartitionDemo() {
  // Check the caller is allowed first: this writes with the service role.
  const store = createSupabaseRuntimeStore(createAdminClient());
  // A fixed runId makes re-runs idempotent (same ids, no new rows). Use crypto.randomUUID() for a fresh run.
  return runPartitionDemo({ store, runId: "demo-partition" });
}
```

- **Records** land on the seeded synthetic investigations `partition-recovery` and `weather-timeout`, so they appear in the existing read APIs next to the seeded demo data.
- **Step-by-step display without stored agent state:** `runPartitionDemo({ seed, runId, stopAtMs })` replays deterministically to any simulated time, so each request recomputes the same state. Alternatively, return the full result once and let the UI animate its `phases` and `timeline`.
- **Real investigations:** fetch context on the server with `getOpenMeteo().getWeatherContext(...)` and `getEonet().getWildfireContext(...)`. Then enqueue `weather.context` (`{ context }`) and `eonet.context` (`{ context, timeOfInterest }`) on a `weather` agent from `createDemoAgents({ runId, store, mode: "live" })`, and drive it with `createSimulation`. Live mode refuses synthetic stand-ins and synthetic records.

## Plugging in validators and fusion (Danil)

Pass processors per agent; one with the same `kind` replaces the stand-in:

```ts
runPartitionDemo({
  processors: { vision: [visionProcessor], fusion: [fusionProcessor] },
  onEvidence: { fusion: ({ evidence, newEvents }) => [/* tasks, e.g. id `fusion:${investigationId}:${n}` */] },
});
```

`defineProcessor({ kind, input: zodSchema, run(ctx) })` receives the validated `ctx.input`, `ctx.upstream` (complete outputs of its `after` tasks), and `ctx.evidence` (canonical observations and findings this agent holds). It returns `{ observations?, findings?, followUps? }`. Call Claude before enqueueing, and pass the validated model output as the task input. `onEvidence` lets fusion re-run as evidence arrives: derive the task id from the evidence so each evidence set runs once.

## Showing it (Outrolife)

- **Persisted:** the detail API's `events` already carry `partition_started`, `partition_healed`, `reconciled` (details per `reconciledEventDetailsSchema`) and `finding_recorded`.
- **The run itself:** `PartitionDemoResult` has `phases` (tasks completed, blocked tasks with what they wait for, per-peer reachability, unconfirmed counts), `reconciliation`, `checks`, `network.links` (up or down, dropped, duplicated) and a bounded `timeline`. All times are simulated milliseconds, and the result is plain JSON.

## Limitations

- **One process.** It's a simulation: agents are logically isolated objects in one process, with no shared references (every boundary is a JSON copy). They aren't separate machines, and nothing here is production-grade distributed infrastructure.
- **Authentication and conflicts.** Agents don't authenticate each other cryptographically. Conflict detection catches divergent copies, and the canonical copy converges deterministically, but spreading the conflict record to every replica is best effort.
- **Stand-ins.** The satellite and vision agents run labelled synthetic stand-ins. Live satellite data needs Outrolife's FIRMS output as task input; live vision needs Danil's validator.
- **Heuristics.** Weather thresholds (humidity under 30%, wind of 25 km/h or more, 2 mm of rain in 24 hours) are uncalibrated descriptions, never a fire verdict.
- **No baseline.** No centralised baseline was measured, so this makes no improvement claims.
