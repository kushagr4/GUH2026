// Where agents run. The simulation talks to agents only through this interface,
// so the same scenario runs unchanged in one process (deterministic, deployable
// anywhere, including a Vercel function or a browser) or with one worker thread
// per agent (separate V8 isolates and heaps, local Node.js only).
import type { AgentSnapshot } from "./agent";
import type { RuntimeTask } from "./processors";
import type { Envelope, SimTime } from "./types";

export type HostKind = "in-process" | "worker-threads";

/**
 * An agent's snapshot, plus where it ran. `threadId` is the agent's own worker
 * thread, or null when it shares the caller's thread (in-process).
 */
export type HostedAgentSnapshot = AgentSnapshot & { host: HostKind; threadId: number | null };

export type AgentHost = {
  readonly kind: HostKind;
  readonly agentIds: readonly string[];
  enqueue(agentId: string, task: RuntimeTask): Promise<boolean>;
  deliver(agentId: string, envelopes: Envelope[]): Promise<void>;
  /** Lets the agent do one unit of work; returns what it wants to send. */
  step(agentId: string, now: SimTime): Promise<Envelope[]>;
  snapshot(agentId: string): Promise<HostedAgentSnapshot>;
  close(): Promise<void>;
};
