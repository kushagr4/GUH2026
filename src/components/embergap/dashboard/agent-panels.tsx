import type { AgentEvent, AgentFinding, AgentId, Observation } from "@/lib/embergap/contracts";
import { ACTOR_LABEL, ASSESSMENT_LABEL, ASSESSMENT_TONE, STRENGTH_LABEL, formatUtc } from "./labels";
import { SOURCE_FEED, SourceChip, provenanceLabel } from "./data-sources";
import { ToneBadge } from "./tone-badge";

const AGENTS: AgentId[] = ["witness", "vision", "satellite", "weather", "fusion"];

/** What each agent reads, before it has reported. */
const AGENT_FEED: Record<AgentId, { icon: string; label: string }> = {
  witness: SOURCE_FEED.human,
  vision: SOURCE_FEED.vision,
  satellite: SOURCE_FEED.firms,
  weather: { icon: SOURCE_FEED.weather.icon, label: "Open-Meteo + NASA EONET" },
  fusion: { icon: "⚖", label: "The other four agents" },
};

/** The feeds behind one finding: the providers of the observations it cites. */
function feedsFor(finding: AgentFinding, observations: Observation[]): string[] {
  const cited = observations.filter((observation) => finding.evidenceIds.includes(observation.id));
  return [...new Set(cited.map((observation) => provenanceLabel(observation.provenance)))];
}

/** One tile per independent agent: where its data came from, and its latest finding. */
export function AgentStrip({ findings, observations }: { findings: AgentFinding[]; observations: Observation[] }) {
  const latest = new Map<AgentId, AgentFinding>();
  for (const finding of [...findings].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(finding.agentId, finding);
  return (
    <section aria-labelledby="agents-heading" className="flex flex-col gap-2">
      <h2 id="agents-heading" className="text-lg font-semibold">
        Independent agents
      </h2>
      <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {AGENTS.map((agent) => {
          const finding = latest.get(agent);
          return (
            <li key={agent} className="flex flex-col gap-1.5 rounded-xl border bg-card px-3 py-2.5 text-sm shadow-xs">
              <span className="font-medium">{ACTOR_LABEL[agent]}</span>
              <SourceChip
                icon={AGENT_FEED[agent].icon}
                label={(finding && agent !== "fusion" && agent !== "witness" && feedsFor(finding, observations).join(", ")) || AGENT_FEED[agent].label}
                synthetic={finding?.isSynthetic}
                wrap
                className="self-start"
              />
              {finding ? (
                <>
                  <ToneBadge tone={ASSESSMENT_TONE[finding.assessment]}>
                    {agent === "fusion" ? "Recommendation" : ASSESSMENT_LABEL[finding.assessment]}
                    {finding.strength ? ` · ${STRENGTH_LABEL[finding.strength]}` : ""}
                  </ToneBadge>
                  <span className="text-xs text-muted-foreground">{formatUtc(finding.createdAt)}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">No finding yet</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Where a finding's evidence came from: provider and product, and whether it is simulated. */
export function Provenance({ finding, observations }: { finding: AgentFinding; observations: Observation[] }) {
  const cited = observations.filter((observation) => finding.evidenceIds.includes(observation.id));
  const sources = [...new Set(cited.map((observation) => provenanceLabel(observation.provenance)))];
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {finding.isSynthetic ? <ToneBadge tone="neutral">Demo</ToneBadge> : null}
      <span>Data from: {sources.length ? sources.join("; ") : "the other agents' findings"}</span>
    </p>
  );
}

type Step = { label: string; detail: string | null; done: boolean };

/**
 * The simulated network partition, from the runtime's own events: connected,
 * cut, agents continuing alone, restored, reconciled. Nothing is animated.
 */
export function PartitionTimeline({ events }: { events: AgentEvent[] }) {
  const started = events.find((event) => event.type === "partition_started");
  if (!started) return null;
  const healed = events.find((event) => event.type === "partition_healed");
  const reconciled = events.find((event) => event.type === "reconciled");
  const numbers = (reconciled?.details ?? {}) as { redelivered?: number; duplicatesIgnored?: number; completedWhileIsolated?: number; isolated?: string[] };
  const isolated = ((started.details as { isolated?: string[] } | null)?.isolated ?? []).join(", ");
  const steps: Step[] = [
    { label: "Connected", detail: "All agents exchanging evidence.", done: true },
    { label: "Network disconnected", detail: `${isolated ? `Isolated: ${isolated}. ` : ""}${formatUtc(started.occurredAt)}`, done: true },
    {
      label: "Agents continued independently",
      detail: numbers.completedWhileIsolated !== undefined ? `${numbers.completedWhileIsolated} task(s) finished while isolated.` : "Each agent kept working on local tasks.",
      done: true,
    },
    { label: "Network restored", detail: healed ? formatUtc(healed.occurredAt) : null, done: Boolean(healed) },
    {
      label: "Evidence reconciled",
      detail: reconciled ? `${numbers.redelivered ?? 0} redelivered, ${numbers.duplicatesIgnored ?? 0} duplicate(s) ignored, nothing lost.` : null,
      done: Boolean(reconciled),
    },
  ];
  return (
    <section aria-labelledby="partition-heading" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <h2 id="partition-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        Network partition <ToneBadge tone="neutral">Simulation</ToneBadge>
      </h2>
      <ol className="grid gap-2 sm:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step.label} className={`flex flex-col gap-1 rounded-lg border-t-4 px-2 pt-2 text-sm ${step.done ? (index === 1 ? "border-red-500" : index === 2 ? "border-amber-400" : "border-emerald-500") : "border-muted opacity-60"}`}>
            <span className="font-medium">{step.label}</span>
            {step.detail ? <span className="text-xs text-muted-foreground">{step.detail}</span> : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        A deterministic simulation inside one run, not a deployed network of separate machines.
      </p>
    </section>
  );
}
