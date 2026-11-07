// All agents in one process. Each agent's state is still private to its own
// RuntimeAgent, and everything crossing the host boundary is a structured clone,
// so no object is ever shared between agents. Deterministic, and free of
// Node-only APIs, so it runs in tests, in a serverless function and in a browser.
import type { RuntimeAgent } from "../agent";
import type { AgentHost } from "../host";

export function createInProcessHost(agents: readonly RuntimeAgent[]): AgentHost {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  if (byId.size !== agents.length) throw new Error("Agent ids must be unique");
  const get = (agentId: string) => {
    const agent = byId.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  };

  return {
    kind: "in-process",
    agentIds: [...byId.keys()].sort(),
    async enqueue(agentId, task) {
      return get(agentId).enqueueTask(structuredClone(task));
    },
    async deliver(agentId, envelopes) {
      get(agentId).deliver(structuredClone(envelopes));
    },
    async step(agentId, now) {
      return get(agentId).step(now);
    },
    async snapshot(agentId) {
      return { ...get(agentId).snapshot(), host: "in-process", threadId: null };
    },
    async close() {},
  };
}
