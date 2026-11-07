import type { MapFeature } from "@/lib/embergap/contracts";

/** Contract types used for labels, re-exported in one place for the UI. */
export type {
  AgentEventType,
  Assessment,
  EventActor,
  EvidenceStrength,
  InvestigationStatus,
  ReviewPriority,
  SourceKind,
  SourceState,
} from "@/lib/embergap/contracts";

export type FirmsDetectionConfidence = NonNullable<MapFeature["firms"]>["confidence"];
