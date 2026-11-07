// An in-memory EmberGapRuntimeStore (the port in @/lib/embergap/contracts), for
// tests and the offline demo. Mac's Supabase store replaces it in the app.
// Like the real one it is write-only for agents and idempotent: saving the
// same id, or appending the same idempotency key, twice keeps the first.
import {
  AUTOMATED_INVESTIGATION_STATUSES,
  agentEventSchema,
  agentFindingSchema,
  observationSchema,
  type AgentEvent,
  type AgentFinding,
  type EmberGapRuntimeStore,
  type Observation,
  type ReviewPriority,
} from "@/lib/embergap/contracts";

export type MemoryStoreContents = {
  observations: Observation[];
  findings: AgentFinding[];
  /** Oldest first, by occurredAt then insertion. */
  events: AgentEvent[];
  statuses: Array<{
    investigationId: string;
    status: (typeof AUTOMATED_INVESTIGATION_STATUSES)[number];
    reviewPriority: ReviewPriority | null;
  }>;
  /** Writes ignored because the id or key was already stored. */
  duplicatesIgnored: number;
};

export type MemoryRuntimeStore = EmberGapRuntimeStore & { contents(): MemoryStoreContents };

export function createMemoryRuntimeStore(): MemoryRuntimeStore {
  const observations = new Map<string, Observation>();
  const findings = new Map<string, AgentFinding>();
  const events = new Map<string, AgentEvent>();
  const statuses = new Map<string, MemoryStoreContents["statuses"][number]>();
  let duplicatesIgnored = 0;

  return {
    async appendEvents(batch) {
      for (const event of batch) {
        const parsed = agentEventSchema.parse(event);
        const key = `${parsed.investigationId}|${parsed.idempotencyKey}`;
        if (events.has(key)) duplicatesIgnored += 1;
        else events.set(key, structuredClone(parsed));
      }
    },
    async saveObservations(batch) {
      for (const observation of batch) {
        const parsed = observationSchema.parse(observation);
        if (observations.has(parsed.id)) duplicatesIgnored += 1;
        else observations.set(parsed.id, structuredClone(parsed));
      }
    },
    async saveFinding(finding) {
      const parsed = agentFindingSchema.parse(finding);
      if (findings.has(parsed.id)) duplicatesIgnored += 1;
      else findings.set(parsed.id, structuredClone(parsed));
    },
    async setAutomatedStatus(investigationId, status, reviewPriority) {
      if (!AUTOMATED_INVESTIGATION_STATUSES.includes(status)) throw new Error("Software may not set that status");
      statuses.set(investigationId, { investigationId, status, reviewPriority });
    },
    contents() {
      const ordered = [...events.values()]
        .map((event, index) => ({ event, index }))
        .sort((a, b) => a.event.occurredAt.localeCompare(b.event.occurredAt) || a.index - b.index)
        .map(({ event }) => event);
      return structuredClone({
        observations: [...observations.values()],
        findings: [...findings.values()],
        events: ordered,
        statuses: [...statuses.values()],
        duplicatesIgnored,
      });
    },
  };
}
