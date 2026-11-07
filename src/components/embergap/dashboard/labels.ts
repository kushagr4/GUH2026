import type {
  AgentEventType,
  Assessment,
  EventActor,
  EvidenceStrength,
  FirmsDetectionConfidence,
  InvestigationStatus,
  ReviewPriority,
  SourceKind,
  SourceState,
} from "./label-types";

/** Badge colours. Kept as Tailwind classes so they work with the neutral theme. */
export type Tone = "danger" | "warning" | "info" | "success" | "neutral";

export const TONE_CLASS: Record<Tone, string> = {
  danger: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  neutral: "border-border bg-muted text-muted-foreground",
};

export const STATUS_LABEL: Record<InvestigationStatus, string> = {
  unreviewed: "Unreviewed",
  investigating: "Investigating",
  needs_human_review: "Needs human review",
  insufficient_evidence: "Insufficient evidence",
  reviewed: "Reviewed",
};

export const STATUS_TONE: Record<InvestigationStatus, Tone> = {
  unreviewed: "neutral",
  investigating: "info",
  needs_human_review: "warning",
  insufficient_evidence: "neutral",
  reviewed: "success",
};

export function priorityLabel(priority: ReviewPriority | null): string {
  return priority ? `${priority[0]!.toUpperCase()}${priority.slice(1)} review priority` : "Priority not set";
}

export function priorityTone(priority: ReviewPriority | null): Tone {
  if (priority === "high") return "danger";
  if (priority === "medium") return "warning";
  if (priority === "low") return "info";
  return "neutral";
}

export const ASSESSMENT_LABEL: Record<Assessment, string> = {
  supports: "Supports",
  contradicts: "Contradicts",
  inconclusive: "Inconclusive",
  context: "Context",
};

export const ASSESSMENT_TONE: Record<Assessment, Tone> = {
  supports: "warning",
  contradicts: "info",
  inconclusive: "neutral",
  context: "neutral",
};

export const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  weak: "weak",
  moderate: "moderate",
  strong: "strong",
};

export const SOURCE_STATE_LABEL: Record<SourceState, string> = {
  available: "Available",
  stale: "Stale",
  unavailable: "Unavailable",
  not_observed: "Nothing found (unknown)",
};

export const SOURCE_STATE_TONE: Record<SourceState, Tone> = {
  available: "success",
  stale: "warning",
  unavailable: "danger",
  not_observed: "neutral",
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  human: "Reports",
  firms: "NASA FIRMS thermal anomalies",
  weather: "Weather",
  eonet: "NASA EONET events",
  vision: "Photo description",
};

export const ACTOR_LABEL: Record<EventActor, string> = {
  vision: "Vision agent",
  satellite: "Satellite agent",
  weather: "Weather agent",
  witness: "Witness agent",
  fusion: "Fusion agent",
  system: "System",
  reporter: "Reporter",
  reviewer: "Reviewer",
};

/** Timeline events that show the partition and recovery story. */
export const NETWORK_EVENTS: ReadonlySet<AgentEventType> = new Set([
  "partition_started",
  "partition_healed",
  "message_delivered",
  "message_dropped",
  "duplicate_ignored",
  "reconciled",
]);

/** FIRMS confidence as text: a class, or MODIS's 0-100 scale. Never a percentage. */
export function confidenceLabel(confidence: FirmsDetectionConfidence): string {
  if (confidence === null) return "not reported";
  if (typeof confidence === "number") return `${confidence} on the MODIS 0-100 scale`;
  return `${confidence} class`;
}

/** "just now", "12 min", "3 h 10 min", "2 days" before `to`. */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.floor(minutes / (24 * 60))} days`;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Nov, 14:20 UTC". Always UTC, so server and browser render the same text. */
export function formatUtc(iso: string | null): string {
  if (!iso) return "unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

/** "thermal_anomaly_nearby" becomes "thermal anomaly nearby"; namespaces are kept readable. */
export function humanizeCode(code: string): string {
  return code.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();
}

/** Accent colours (Tailwind classes) so each source, agent and verdict is recognisable at a glance. */
export const SOURCE_ACCENT: Record<SourceKind, string> = {
  firms: "border-t-orange-500",
  weather: "border-t-sky-500",
  eonet: "border-t-emerald-500",
  vision: "border-t-violet-500",
  human: "border-t-slate-400",
};

export const ASSESSMENT_ACCENT: Record<Assessment, string> = {
  supports: "border-l-amber-500",
  contradicts: "border-l-sky-500",
  inconclusive: "border-l-slate-300 dark:border-l-slate-600",
  context: "border-l-slate-300 dark:border-l-slate-600",
};

export const ACTOR_DOT: Record<EventActor, string> = {
  vision: "bg-violet-500",
  satellite: "bg-orange-500",
  weather: "bg-sky-500",
  witness: "bg-emerald-500",
  fusion: "bg-rose-500",
  system: "bg-slate-400",
  reporter: "bg-slate-500",
  reviewer: "bg-slate-700",
};

export function priorityAccent(priority: ReviewPriority | null): string {
  if (priority === "high") return "border-l-red-500";
  if (priority === "medium") return "border-l-yellow-400";
  if (priority === "low") return "border-l-sky-500";
  return "border-l-slate-300";
}
