import "server-only";
// The EmberGap agent runtime's public API (Claude PC). Server-side only: the
// browser shows runtime results through the read APIs, it never runs agents.
//
//   runPartitionDemo()       the whole partition demonstration, deterministic,
//                            in one short-lived call (fits a Vercel function)
//   createDemoAgents()       the weather, satellite, vision and fusion agents,
//                            with processors replaceable per kind
//   createSimulation(), createSimulatedNetwork(), createInProcessHost()
//                            the parts, to build other scenarios
//   createMemoryRuntimeStore()
//                            the contract's EmberGapRuntimeStore in memory, for
//                            tests; the app uses Mac's createSupabaseRuntimeStore
// See docs/embergap-data-runtime.md for how to invoke it from the backend.
export { DEFAULT_EPOCH_ISO, RuntimeAgent, displayOrder, hashEvent, historyHashOf } from "./agent";
export type {
  AgentConfig,
  AgentLogEntry,
  AgentMetrics,
  AgentSnapshot,
  ConflictRecord,
  PeerSnapshot,
  PeerStatus,
  TaskSnapshot,
  TaskStatus,
} from "./agent";
export type { AgentHost, HostKind, HostedAgentSnapshot } from "./host";
export { createInProcessHost } from "./hosts/in-process";
export { PERFECT_LINK, createSimulatedNetwork } from "./network";
export type { FaultRule, LinkPolicy, LinkStatus, NetworkLogEntry, NetworkStatus, SimulatedNetwork } from "./network";
export { ProcessorError, defineProcessor } from "./processors";
export type {
  EvidenceHook,
  EvidenceView,
  FindingDraft,
  ProcessorContext,
  ProcessorResult,
  Readiness,
  RuntimeMode,
  RuntimeTask,
  TaskDraft,
  TaskProcessor,
  UpstreamResult,
} from "./processors";
export { createSimulation } from "./simulation";
export type { PendingTask, Reconciliation, RuntimeStatus, ScenarioAction, Simulation, TimelineEntry } from "./simulation";
export { createMemoryRuntimeStore } from "./store";
export type { MemoryRuntimeStore, MemoryStoreContents } from "./store";
export { RUNTIME_SCHEMA_VERSION, eventIdFor, findingIdFor } from "./types";
export type { RuntimeEvent, TaskOutcome } from "./types";
export { DEMO_AGENT_IDS, FIRE_WEATHER_HEURISTICS, createDemoAgents } from "./scenarios/demo-agents";
export type { DemoAgentId, DemoAgentOptions } from "./scenarios/demo-agents";
export { DEMO_LINK, DEMO_PARTITION, DEMO_PHASES, demoActions, runPartitionDemo } from "./scenarios/partition-demo";
export type { DemoCheck, PartitionDemoOptions, PartitionDemoResult, PhaseSummary } from "./scenarios/partition-demo";
