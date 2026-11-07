import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { defaultRunner, canRunAgents, scheduleInvestigation } = await import("@/features/embergap/orchestrator");
const { after } = await import("next/server");
import {
  agentEventSchema,
  agentFindingSchema,
  stableId,
  SYNTHETIC_SCENARIOS,
  type AgentEvent,
  type AgentFinding,
  type AgentReport,
  type EmberGapRuntimeStore,
} from "@/lib/embergap/contracts";

function memoryStore() {
  const findings = new Map<string, AgentFinding>();
  const events = new Map<string, AgentEvent>();
  const statuses: [string, string, string | null][] = [];
  const store: EmberGapRuntimeStore = {
    async appendEvents(list) {
      for (const event of list) events.set(`${event.investigationId}:${event.idempotencyKey}`, agentEventSchema.parse(event));
    },
    async saveObservations() {},
    async saveFinding(finding) {
      if (!findings.has(finding.id)) findings.set(finding.id, agentFindingSchema.parse(finding));
    },
    async setAutomatedStatus(id, status, priority) {
      statuses.push([id, status, priority]);
    },
  };
  return { store, findings, events, statuses };
}

const scenario = SYNTHETIC_SCENARIOS.find((entry) => entry.id === "repeated-witness")!;
const reports: AgentReport[] = scenario.reportIds.map((id, index) => ({
  id,
  investigationId: scenario.investigationId,
  observedAt: `2026-11-07T11:${20 + index * 8}:00.000Z`,
  submittedAt: `2026-11-07T11:${25 + index * 6}:00.000Z`,
  description: index === 0 ? "Smoke near the rocks on the moor top." : "Same smoke as before, near the rocks.",
  location: { latitude: 53.913, longitude: -1.832, uncertaintyMeters: 500 },
  reporterKey: "11111111-1111-4111-8111-111111111111",
  media: null,
  isSynthetic: true,
}));

function run(store: EmberGapRuntimeStore) {
  return defaultRunner({
    investigationId: scenario.investigationId,
    reports,
    store,
    now: () => "2026-11-07T12:00:00.000Z",
    newId: (name) => stableId(`${scenario.investigationId}:${name}`),
    signal: new AbortController().signal,
  });
}

describe("defaultRunner (serverless, idempotent)", () => {
  it("queues a task per agent, records each agent's own finding, and sets an automated status", async () => {
    const memory = memoryStore();
    await run(memory.store);

    const types = [...memory.events.values()].map((event) => event.type);
    expect(types.filter((type) => type === "task_queued")).toHaveLength(5);
    expect(types).toContain("finding_recorded");

    const agents = [...memory.findings.values()].map((finding) => finding.agentId);
    expect(agents).toEqual(expect.arrayContaining(["witness", "fusion"]));
    const fusion = [...memory.findings.values()].find((finding) => finding.agentId === "fusion")!;
    expect(fusion.assessment).toBe("context");
    expect(fusion.recommendation?.recommendedStatus).not.toBe("reviewed");

    expect(memory.statuses).toHaveLength(1);
    expect(memory.statuses[0][1]).not.toBe("reviewed");
  });

  it("writes the same IDs when retried, so a repeated run never duplicates", async () => {
    const memory = memoryStore();
    await run(memory.store);
    const findings = memory.findings.size;
    const events = memory.events.size;
    await run(memory.store);
    expect(memory.findings.size).toBe(findings);
    expect(memory.events.size).toBe(events);
  });
});

describe("scheduleInvestigation", () => {
  it("does nothing without the server-only secret key", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(canRunAgents()).toBe(false);
    expect(scheduleInvestigation(scenario.investigationId)).toBe(false);
    expect(after).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("runs after the response when the key is configured", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
    expect(scheduleInvestigation(scenario.investigationId)).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});
