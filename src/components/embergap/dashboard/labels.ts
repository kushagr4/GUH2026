import type {
  AgentId,
  Assessment,
  Freshness,
  InvestigationStatus,
  ReviewPriority,
  SourceState,
} from "@/lib/embergap/read/types";

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

export const PRIORITY_LABEL: Record<ReviewPriority, string> = {
  high: "High review priority",
  medium: "Medium review priority",
  low: "Low review priority",
  undetermined: "Priority undetermined",
};

export const PRIORITY_TONE: Record<ReviewPriority, Tone> = {
  high: "danger",
  medium: "warning",
  low: "info",
  undetermined: "neutral",
};

export const ASSESSMENT_LABEL: Record<Assessment, string> = {
  supports: "Supports",
  contradicts: "Contradicts",
  inconclusive: "Inconclusive",
};

export const ASSESSMENT_TONE: Record<Assessment, Tone> = {
  supports: "warning",
  contradicts: "info",
  inconclusive: "neutral",
};

export const SOURCE_STATE_LABEL: Record<SourceState, string> = {
  available: "Available",
  stale: "Stale",
  unavailable: "Unavailable",
  not_observed: "Nothing observed (unknown)",
};

export const SOURCE_STATE_TONE: Record<SourceState, Tone> = {
  available: "success",
  stale: "warning",
  unavailable: "danger",
  not_observed: "neutral",
};

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "Fresh",
  recent: "Recent",
  stale: "Stale",
};

export const AGENT_LABEL: Record<AgentId | "system", string> = {
  vision: "Vision agent",
  satellite: "Satellite agent",
  weather: "Weather agent",
  witness: "Witness agent",
  fusion: "Fusion agent",
  system: "System",
};

/** "just now", "12 min ago", "3 h 10 min ago", "2 days ago". */
export function formatAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min ago` : `${hours} h ago`;
  }
  return `${Math.floor(minutes / (24 * 60))} days ago`;
}

export function minutesBetween(fromIso: string, to: Date | string): number {
  const end = typeof to === "string" ? Date.parse(to) : to.getTime();
  return Math.max(0, Math.round((end - Date.parse(fromIso)) / 60_000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Nov, 14:20 UTC". Always UTC, so server and browser render the same text. */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

/** "thermal_anomaly_nearby" becomes "thermal anomaly nearby". */
export function humanizeCode(code: string): string {
  return code.replace(/_/g, " ");
}
