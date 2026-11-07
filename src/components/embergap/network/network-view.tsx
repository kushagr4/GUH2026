"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NETWORK_CARD, NETWORK_EYEBROW } from "./network-styles";
import type { NetworkViewModel, NodeView, StageView } from "./view-model";

const STEP_MS = 2_500;

/** One plain sentence per stage. The runtime's own detail (counts and IDs) stays in the tooltip. */
const STAGE_TEXT: Record<string, string> = {
  connected: "All four agents can reach each other and share every update.",
  partitioned: "The network splits in two. Each side can only talk to itself.",
  working_in_isolation: "Both sides keep working with what they have. Tasks that need the other side's evidence wait.",
  reconnected: "The link is back. Agents send each other everything they missed.",
  reconciled: "Every agent has the same history again: nothing lost, no duplicate counted twice.",
};
const SHORT: Record<string, string> = { weather: "Weather", satellite: "Satellite", vision: "Vision", fusion: "Fusion" };
const ORDER = ["weather", "vision", "satellite", "fusion"];


function words(value: string) {
  return value.replace(/_/g, " ");
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The first clause of a sentence: enough to read at a glance. */
function shortText(text: string, max = 110) {
  const end = text.search(/[.;!?](\s|$)/);
  const first = end === -1 ? text : text.slice(0, end);
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

/** Slower autoplay for people who ask for reduced motion. */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCED_MOTION).matches),
    () => false,
  );
}

type Status = { label: string; tone: "ok" | "warn" | "cut" };

function statusOf(node: NodeView, stage: StageView): Status {
  if (stage.split && node.reachable.length < 3) return { label: "Cut off, still working", tone: "cut" };
  if (node.blockedOn.length) return { label: "Waiting for evidence", tone: "warn" };
  return { label: "Connected", tone: "ok" };
}

const PILL: Record<Status["tone"], string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  cut: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

/**
 * Two sides with one bridge between them. The partition always splits the
 * network into these two groups, so the cross-side links are drawn as one
 * bridge instead of four crossing lines.
 */
function Diagram({ stage, groups }: { stage: StageView; groups: string[][] }) {
  const byOrder = (ids: string[]) => [...ids].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const left = byOrder(groups.find((group) => group.includes("weather")) ?? ["weather", "vision"]);
  const right = byOrder(groups.find((group) => !group.includes("weather")) ?? ["satellite", "fusion"]);
  const side = (id: string) => (left.includes(id) ? "left" : "right");
  const linkUp = (a: string, b: string) =>
    stage.links.find((link) => (link.a === a && link.b === b) || (link.a === b && link.b === a))?.up ?? false;
  const cross = stage.links.filter((link) => side(link.a) !== side(link.b));
  const crossUp = cross.filter((link) => link.up).length;
  const bridgeUp = crossUp === cross.length;
  const nodes = new Map(stage.nodes.map((node) => [node.id, node]));

  const W = 560;
  const H = 280;
  const cardW = 168;
  const cardH = 66;
  const slots = {
    left: { x: 24, ys: [42, 172] },
    right: { x: W - 24 - cardW, ys: [42, 172] },
  } as const;

  const card = (id: string, x: number, y: number) => {
    const node = nodes.get(id);
    if (!node) return null;
    const status = statusOf(node, stage);
    const dot = status.tone === "ok" ? "fill-emerald-500" : status.tone === "warn" ? "fill-amber-500" : "fill-red-500";
    return (
      <g key={id}>
        <rect
          x={x}
          y={y}
          width={cardW}
          height={cardH}
          rx="14"
          strokeWidth="2"
          className={cn(
            "fill-white dark:fill-[#211711]",
            id === "fusion" ? "stroke-orange-400" : "stroke-[#e8d3bd] dark:stroke-[#674632]",
          )}
        />
        <circle cx={x + 20} cy={y + 24} r="5" className={dot} />
        <text x={x + 34} y={y + 29} className="fill-[#49200c] text-[16px] font-semibold dark:fill-[#fff0db]">
          {SHORT[id] ?? id}
        </text>
        <text x={x + 20} y={y + 51} className="fill-[#8a6a55] text-[13px] dark:fill-[#e5c7ad]">
          {node.knows.events !== undefined ? `knows ${node.knows.events} updates` : `${node.tasksCompleted} tasks done`}
        </text>
      </g>
    );
  };

  const vertical = (ids: string[], x: number) => {
    const [top, bottom] = ids;
    if (!top || !bottom) return null;
    const up = linkUp(top, bottom);
    return (
      <line
        x1={x + cardW / 2}
        y1={42 + cardH}
        x2={x + cardW / 2}
        y2={172}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={up ? undefined : "8 7"}
        className={up ? "stroke-emerald-500" : "stroke-red-500"}
      />
    );
  };

  const bridgeX1 = slots.left.x + cardW;
  const bridgeX2 = slots.right.x;
  const mid = (bridgeX1 + bridgeX2) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Agent network: ${stage.label}`} className="h-auto w-full">
      <rect
        x="8"
        y="8"
        width={cardW + 32}
        height={H - 16}
        rx="20"
        strokeWidth="1.5"
        className={stage.split ? "fill-sky-500/10 stroke-sky-400/60" : "fill-transparent stroke-[#f0deca] dark:stroke-[#674632]"}
      />
      <rect
        x={W - 8 - (cardW + 32)}
        y="8"
        width={cardW + 32}
        height={H - 16}
        rx="20"
        strokeWidth="1.5"
        className={stage.split ? "fill-amber-500/10 stroke-amber-400/60" : "fill-transparent stroke-[#f0deca] dark:stroke-[#674632]"}
      />
      <text x={8 + (cardW + 32) / 2} y="30" textAnchor="middle" className="fill-[#8a6a55] text-[12px] font-semibold dark:fill-[#e5c7ad]">
        SIDE 1
      </text>
      <text x={W - 8 - (cardW + 32) / 2} y="30" textAnchor="middle" className="fill-[#8a6a55] text-[12px] font-semibold dark:fill-[#e5c7ad]">
        SIDE 2
      </text>

      {vertical(left, slots.left.x)}
      {vertical(right, slots.right.x)}

      {[75, 205].map((y) => (
        <line
          key={y}
          x1={bridgeX1}
          y1={y}
          x2={bridgeX2}
          y2={y}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={bridgeUp ? undefined : "8 7"}
          className={bridgeUp ? "stroke-emerald-500" : "stroke-red-500"}
        />
      ))}
      {!bridgeUp ? (
        <g transform={`translate(${mid}, 140)`}>
          <rect x="-46" y="-17" width="92" height="34" rx="17" className="fill-red-50 stroke-red-400 dark:fill-red-950" strokeWidth="1.5" />
          <text textAnchor="middle" y="5" className="fill-red-700 text-[13px] font-semibold dark:fill-red-300">
            ✕ Split
          </text>
        </g>
      ) : null}

      {left.map((id, i) => card(id, slots.left.x, slots.left.ys[i] ?? 42))}
      {right.map((id, i) => card(id, slots.right.x, slots.right.ys[i] ?? 42))}
    </svg>
  );
}

function AgentRow({ node, previous, stage }: { node: NodeView; previous?: NodeView; stage: StageView }) {
  const status = statusOf(node, stage);
  const finding = node.latestFinding;
  return (
    <li className="flex flex-col gap-1.5 border-b border-[#f2e5d7] py-3 last:border-0 dark:border-[#674632]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[#49200c] dark:text-[#fff0db]">{node.label}</span>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", PILL[status.tone])}>{status.label}</span>
      </div>
      <p className="text-sm text-[#705342] dark:text-[#e5c7ad]">
        {node.tasksCompleted} task{node.tasksCompleted === 1 ? "" : "s"} done · {node.knows.findings} finding
        {node.knows.findings === 1 ? "" : "s"} of its own
        {node.blockedOn.length ? (
          <span title={node.blockedOn.join(", ")}>
            {" "}
            · waiting on {node.blockedOn.length} item{node.blockedOn.length === 1 ? "" : "s"} from the other side
          </span>
        ) : null}
      </p>
      {node.id === "fusion" ? (
        node.fusion?.length ? (
          <ul className="flex flex-col gap-1.5">
            {node.fusion.map((rec) => {
              const before = previous?.fusion?.find((item) => item.report === rec.report);
              const changed =
                !before ||
                before.status !== rec.status ||
                before.priority !== rec.priority ||
                before.independentSources !== rec.independentSources;
              return (
                <li
                  key={rec.report}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm",
                    changed ? "border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/40" : "border-[#f0deca] dark:border-[#674632]",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-[#49200c] dark:text-[#fff0db]">{rec.report}</span>
                    {changed ? <span className="text-xs font-semibold text-orange-700 dark:text-orange-300">{before ? "Updated" : "New"}</span> : null}
                  </div>
                  <p className="text-[#705342] dark:text-[#e5c7ad]">
                    {capitalise(words(rec.status))} · {rec.priority} priority · {rec.independentSources} independent source
                    {rec.independentSources === 1 ? "" : "s"}
                  </p>
                  {rec.gaps[0] ? (
                    <p className="text-xs text-[#8a6a55] dark:text-[#d9b99c]" title={rec.gaps.join(" ")}>
                      Gap: {shortText(rec.gaps[0], 80)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[#8a6a55]">No recommendation yet.</p>
        )
      ) : finding ? (
        <p className="text-sm" title={finding.summary}>
          <span className="font-medium text-[#49200c] dark:text-[#fff0db]">{capitalise(words(finding.assessment))}:</span>{" "}
          <span className="text-[#705342] dark:text-[#e5c7ad]">
            {finding.reasonCodes.length ? finding.reasonCodes.map(words).join(", ") : shortText(finding.summary)}
          </span>
        </p>
      ) : (
        <p className="text-sm text-[#8a6a55]">No finding yet.</p>
      )}
    </li>
  );
}

export function NetworkView({ model }: { model: NetworkViewModel }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const last = model.stages.length - 1;
  const stage = model.stages[index];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (index >= last) setPlaying(false);
      else setIndex(index + 1);
    }, reducedMotion ? STEP_MS * 2 : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, reducedMotion]);

  if (!stage) return <p>No stages to show.</p>;
  const previous = index > 0 ? model.stages[index - 1] : undefined;
  const nodes = [...stage.nodes].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const m = model.metrics;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="The partition, step by step" className={cn(NETWORK_CARD, "flex flex-col gap-5")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <ol className="flex w-full min-w-0 items-center gap-1 sm:flex-1">
            {model.stages.map((item, i) => (
              <li key={item.id} className="flex min-w-0 flex-1 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    setPlaying(false);
                  }}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${item.label}`}
                  className="group flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                      i === index
                        ? "border-[#b83d00] bg-[#b83d00] text-white"
                        : i < index
                          ? "border-[#e8a466] bg-[#fff0df] text-[#9c3b08]"
                          : "border-[#f0deca] bg-white text-[#8a6a55] group-hover:border-[#e8a466] dark:bg-[#211711]",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      "hidden truncate text-xs sm:block",
                      i === index ? "font-semibold text-[#49200c] dark:text-[#fff0db]" : "text-[#8a6a55] dark:text-[#e5c7ad]",
                    )}
                  >
                    {item.label}
                  </span>
                </button>
                {i < last ? (
                  <span aria-hidden className={cn("h-0.5 flex-1 rounded sm:mb-5", i < index ? "bg-[#e8a466]" : "bg-[#f0deca]")} />
                ) : null}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
              ← Prev
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-[#b83d00] text-white hover:bg-[#913000]"
              onClick={() => {
                if (!playing && index >= last) setIndex(0);
                setPlaying(!playing);
              }}
              aria-pressed={playing}
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setIndex(Math.min(last, index + 1))} disabled={index === last}>
              Next →
            </Button>
          </div>
        </div>

        <div aria-live="polite" className="flex flex-col gap-1">
          <p className="text-xs font-medium text-[#8a6a55] dark:text-[#e5c7ad]">
            Step {index + 1} of {model.stages.length} · {seconds(stage.simTimeMs)} into the run
          </p>
          <p className="text-xl leading-snug text-[#49200c] sm:text-2xl dark:text-[#fff0db]" title={stage.detail}>
            <span className={cn("font-semibold", stage.split ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
              {stage.label}.
            </span>{" "}
            {STAGE_TEXT[stage.id] ?? stage.detail}
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <Diagram stage={stage} groups={model.groups} />
            <p className="text-sm text-[#705342] dark:text-[#e5c7ad]">
              No central server: agents share updates directly. Cut off, they keep working; reconnected, they catch up and ignore duplicates.
            </p>
          </div>
          <ul aria-label="Agents" className="flex flex-col">
            {nodes.map((node) => (
              <AgentRow key={node.id} node={node} stage={stage} previous={previous?.nodes.find((item) => item.id === node.id)} />
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="proof-heading" className={cn(NETWORK_CARD, "flex flex-col gap-4")}>
        <div>
          <p className={NETWORK_EYEBROW}>From the run itself</p>
          <h2 id="proof-heading" className="mt-1 text-xl font-semibold tracking-tight text-[#49200c] dark:text-[#fff0db]">
            What this proves
          </h2>
        </div>
        <ul className="flex flex-wrap gap-2">
          {model.checks.map((check) => (
            <li
              key={check.name}
              title={check.detail}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                check.passed
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                  : "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
              )}
            >
              <span aria-hidden>{check.passed ? "✓ " : "✕ "}</span>
              <span className="sr-only">{check.passed ? "Passed: " : "Failed: "}</span>
              {capitalise(check.name)}
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              ["Tasks done while cut off", m.completedWhileIsolated],
              ["Updates resent after reconnecting", m.redelivered],
              ["Duplicates safely ignored", m.duplicatesIgnored],
              ["Back in sync after", m.settleMsAfterHeal === null ? null : seconds(m.settleMsAfterHeal)],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl bg-[#fff6ec] p-3 dark:bg-[#211711]">
              <dt className="text-xs text-[#8a6a55] dark:text-[#e5c7ad]">{label}</dt>
              <dd className="text-2xl font-semibold text-[#49200c] dark:text-[#fff0db]">{value ?? "n/a"}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-[#8a6a55] dark:text-[#e5c7ad]">
          {m.messagesSent} messages sent · {m.droppedByPartition} dropped by the split · {m.droppedByLoss} lost at random ·{" "}
          {m.duplicatedOnWire} duplicated in transit
        </p>
      </section>
    </div>
  );
}
