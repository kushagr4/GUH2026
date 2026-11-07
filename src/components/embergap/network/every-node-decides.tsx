import { cn } from "cn";
import { ToneBadge } from "@/components/embergap/dashboard/tone-badge";
import { priorityTone } from "@/components/embergap/dashboard/labels";
import type { EveryNodeSnapshot, EveryNodeViewModel } from "./decentralised-view-model";

const ISLAND_CLASS = [
  "border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/30",
  "border-violet-300 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/30",
];

function Snapshot({ snapshot }: { snapshot: EveryNodeSnapshot }) {
  const split = snapshot.islands.length > 1;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-label={snapshot.title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{snapshot.title}</h3>
        {split ? (
          <span className="rounded border border-red-300 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:border-red-900 dark:text-red-300">
            ✕ link cut
          </span>
        ) : (
          <ToneBadge tone={snapshot.allAgree ? "success" : "warning"}>{snapshot.allAgree ? "all agree" : "disagree"}</ToneBadge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {snapshot.tiles.map((tile) => (
          <div
            key={tile.node}
            className={cn(
              "flex flex-col gap-1 rounded-md border p-2 text-sm",
              split ? ISLAND_CLASS[tile.island % ISLAND_CLASS.length] : "bg-background",
            )}
          >
            <span className="font-medium">{tile.name}</span>
            <span className="text-xs text-muted-foreground">knows {tile.knownFindings} findings</span>
            <span className={cn("font-medium", tile.status === "needs_human_review" && "text-orange-700 dark:text-orange-300")}>
              {tile.statusLabel}
            </span>
            <div className="flex flex-wrap gap-1">
              <ToneBadge tone={priorityTone(tile.priority)}>{tile.priorityLabel}</ToneBadge>
              <ToneBadge tone="neutral">{tile.strengthLabel}</ToneBadge>
            </div>
          </div>
        ))}
      </div>
      {split && <p className="text-xs text-muted-foreground">Islands: {snapshot.islands.map((g) => g.join(" + ")).join("  |  ")}</p>}
    </section>
  );
}

export function EveryNodeDecides({ model }: { model: EveryNodeViewModel }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <h2 className="text-2xl font-semibold tracking-tight">No central decider: every node decides</h2>
      <p>
        Here fusion isn&apos;t a node at all. Every agent runs the same fusion rules on the evidence it holds. While the network is split, each
        island decides for itself; after it heals they agree.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {model.snapshots.map((s) => (
          <Snapshot key={s.id} snapshot={s} />
        ))}
      </div>
      <p className="text-sm font-medium">{model.summary}</p>
    </section>
  );
}
