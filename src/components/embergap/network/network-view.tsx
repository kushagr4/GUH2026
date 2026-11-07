"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NetworkViewModel, NodeView, StageView } from "./view-model";

const STEP_MS = 2_500;

// Square layout: one partition side per column.
const POS: Record<string, { x: number; y: number }> = {
  weather: { x: 90, y: 70 },
  vision: { x: 90, y: 250 },
  satellite: { x: 410, y: 70 },
  fusion: { x: 410, y: 250 },
};

const SHORT: Record<string, string> = { weather: "Weather", satellite: "Satellite", vision: "Vision", fusion: "Fusion" };

function words(value: string) {
  return value.replace(/_/g, " ");
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
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

function Diagram({ stage, groups }: { stage: StageView; groups: string[][] }) {
  const leftGroup = groups.find((group) => group.includes("weather")) ?? [];
  return (
    <svg viewBox="0 0 500 320" role="img" aria-label={`Agent network: ${stage.label}`} className="h-auto w-full max-w-xl">
      {stage.split ? (
        <>
          <rect x="4" y="4" width="238" height="312" rx="16" className="fill-sky-500/10 stroke-sky-500/40" strokeWidth="2" />
          <rect x="258" y="4" width="238" height="312" rx="16" className="fill-amber-500/10 stroke-amber-500/40" strokeWidth="2" />
          <text x="123" y="306" textAnchor="middle" className="fill-sky-700 text-[13px] font-medium dark:fill-sky-300">
            Side 1: {leftGroup.map((id) => SHORT[id] ?? id).join(" + ")}
          </text>
          <text x="377" y="306" textAnchor="middle" className="fill-amber-700 text-[13px] font-medium dark:fill-amber-300">
            Side 2: {(groups.find((group) => group !== leftGroup) ?? []).map((id) => SHORT[id] ?? id).join(" + ")}
          </text>
        </>
      ) : null}
      {stage.links.map((link) => {
        const a = POS[link.a];
        const b = POS[link.b];
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Nudge the two crossing diagonals' ✕ marks apart.
        const diagonal = a.x !== b.x && a.y !== b.y;
        const offset = diagonal ? (link.a === "satellite" || link.b === "satellite" ? -26 : 26) : 0;
        return (
          <g key={`${link.a}-${link.b}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={link.up ? 5 : 4}
              strokeDasharray={link.up ? undefined : "10 8"}
              strokeLinecap="round"
              className={link.up ? "stroke-emerald-500" : "stroke-red-500"}
            />
            {!link.up ? (
              <g transform={`translate(${mx + offset * 0.6}, ${my + offset * 0.4})`}>
                <circle r="14" className="fill-background stroke-red-500" strokeWidth="3" />
                <path d="M -6 -6 L 6 6 M 6 -6 L -6 6" className="stroke-red-500" strokeWidth="4" strokeLinecap="round" />
              </g>
            ) : null}
          </g>
        );
      })}
      {stage.nodes.map((node) => {
        const p = POS[node.id];
        if (!p) return null;
        const blocked = node.blockedOn.length > 0;
        return (
          <g key={node.id} transform={`translate(${p.x}, ${p.y})`}>
            <circle
              r="42"
              strokeWidth="4"
              className={cn("fill-card", node.id === "fusion" ? "stroke-orange-500" : "stroke-foreground/60", blocked && "stroke-amber-500")}
            />
            <text y="-4" textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
              {SHORT[node.id] ?? node.id}
            </text>
            <text y="16" textAnchor="middle" className="fill-muted-foreground text-[12px]">
              {node.knows.events !== undefined ? `${node.knows.events} events` : `${node.tasksCompleted} tasks`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FusionBlock({ node, previous }: { node: NodeView; previous?: NodeView }) {
  if (!node.fusion?.length) return <p className="text-muted-foreground">No recommendation yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {node.fusion.map((rec) => {
        const before = previous?.fusion?.find((item) => item.report === rec.report);
        const changed = !before || before.status !== rec.status || before.priority !== rec.priority || before.independentSources !== rec.independentSources;
        return (
          <div key={rec.report} className={cn("rounded-lg border p-2", changed && "border-orange-500 bg-orange-500/10")}>
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <span className="font-semibold">{rec.report}</span>
              {changed ? <span className="text-xs font-medium text-orange-700 dark:text-orange-300">{before ? "changed" : "new"}</span> : null}
            </div>
            <p>
              <span className="font-medium">{words(rec.status)}</span> · {rec.priority} review priority · {rec.independentSources} independent source
              {rec.independentSources === 1 ? "" : "s"}
            </p>
            {rec.gaps.length ? (
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {rec.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function NodeCard({ node, previous, stage }: { node: NodeView; previous?: NodeView; stage: StageView }) {
  const isolated = stage.split && node.reachable.length < 3;
  return (
    <article
      aria-label={node.label}
      className={cn("flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm text-card-foreground", node.id === "fusion" && "sm:col-span-2 border-orange-500/60")}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{node.label}</h3>
        {isolated ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">cut off, still working</span> : null}
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Knows</dt>
        <dd>
          {node.knows.events !== undefined ? `${node.knows.events} events · ` : ""}
          {node.knows.findings} own finding{node.knows.findings === 1 ? "" : "s"}
        </dd>
        <dt className="text-muted-foreground">Can reach</dt>
        <dd className={cn(node.reachable.length < 3 && "font-medium text-red-700 dark:text-red-300")}>
          {node.reachable.length ? node.reachable.map((id) => SHORT[id] ?? id).join(", ") : "nobody"}
        </dd>
        <dt className="text-muted-foreground">Completed</dt>
        <dd>
          {node.tasksCompleted} task{node.tasksCompleted === 1 ? "" : "s"}
        </dd>
        <dt className="text-muted-foreground">Waiting for</dt>
        <dd className={cn(node.blockedOn.length && "font-medium text-amber-800 dark:text-amber-200")}>
          {node.blockedOn.length ? node.blockedOn.join("; ") : "nothing"}
        </dd>
      </dl>
      {node.id === "fusion" ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            Current review recommendation{stage.split ? " (decided locally, from the evidence on its side only)" : ""}
          </p>
          <FusionBlock node={node} previous={previous} />
        </div>
      ) : node.latestFinding ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Latest ({node.latestFinding.report}):</span> {words(node.latestFinding.assessment)}
          {node.latestFinding.reasonCodes.length ? ` · ${node.latestFinding.reasonCodes.join(", ")}` : ""}. {node.latestFinding.summary}
        </p>
      ) : null}
    </article>
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

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Stage controls" className="flex flex-col gap-3">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {model.stages.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  setPlaying(false);
                }}
                aria-current={i === index ? "step" : undefined}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  i === index ? "border-orange-500 bg-orange-500/10 font-semibold" : "hover:bg-muted",
                  item.split && "border-red-500/50",
                )}
              >
                <span className="text-muted-foreground">{i + 1}.</span> {item.label}
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
            ← Prev
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!playing && index >= last) setIndex(0);
              setPlaying(!playing);
            }}
            aria-pressed={playing}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setIndex(Math.min(last, index + 1))} disabled={index === last}>
            Next →
          </Button>
          <span className="text-sm text-muted-foreground">
            Step {index + 1} of {model.stages.length} · simulated t = {seconds(stage.simTimeMs)}
          </span>
        </div>
        <p aria-live="polite" className="text-xl font-medium leading-snug sm:text-2xl">
          <span className={cn("mr-2", stage.split ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>{stage.label}.</span>
          {stage.detail}
        </p>
      </section>

      <section aria-label="Network and agents" className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-3">
          <Diagram stage={stage} groups={model.groups} />
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-8 rounded bg-emerald-500" /> link up
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-0 w-8 border-t-4 border-dashed border-red-500" /> link cut ✕
            </span>
          </div>
          <aside className="rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed">
            <h2 className="mb-1 text-base font-semibold">How they talk</h2>
            <p>
              Each agent keeps its own copy of the evidence and gossips what its neighbours are missing. No central server. When a link breaks,
              agents keep working with what they have; on reconnection they swap what&apos;s missing, ignore duplicates, and end with identical
              histories.
            </p>
          </aside>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stage.nodes.map((node) => (
            <NodeCard key={node.id} node={node} stage={stage} previous={previous?.nodes.find((item) => item.id === node.id)} />
          ))}
        </div>
      </section>

      <section aria-label="Proof from the runtime" className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Proof from the run itself</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {model.checks.map((check) => (
            <li key={check.name} className="flex items-start gap-2 text-sm" title={check.detail}>
              <span aria-hidden className={cn("text-lg leading-none", check.passed ? "text-emerald-600" : "text-red-600")}>
                {check.passed ? "✔" : "✘"}
              </span>
              <span>
                <span className="sr-only">{check.passed ? "Passed: " : "Failed: "}</span>
                {check.name}
              </span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Events redelivered after the heal", model.metrics.redelivered],
            ["Duplicates ignored", model.metrics.duplicatesIgnored],
            ["Tasks completed while isolated", model.metrics.completedWhileIsolated],
            ["Settled after the heal", model.metrics.settleMsAfterHeal === null ? null : seconds(model.metrics.settleMsAfterHeal)],
            ["Messages sent", model.metrics.messagesSent],
            ["Dropped by the partition", model.metrics.droppedByPartition],
            ["Dropped by random loss", model.metrics.droppedByLoss],
            ["Duplicated on the wire", model.metrics.duplicatedOnWire],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-muted/50 p-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-semibold">{value ?? "n/a"}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">Simulated time, seeded and deterministic. Links also lose and duplicate messages at random throughout.</p>
      </section>
    </div>
  );
}
