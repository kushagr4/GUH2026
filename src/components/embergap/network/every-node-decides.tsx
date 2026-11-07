import { cn } from "cn";
import { ToneBadge } from "@/components/embergap/dashboard/tone-badge";
import { priorityTone } from "@/components/embergap/dashboard/labels";
import type { EveryNodeSnapshot, EveryNodeViewModel } from "./decentralised-view-model";
import { NETWORK_CARD, NETWORK_EYEBROW } from "./network-styles";

const ISLAND_CLASS = [
  "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40",
  "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
];

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function Snapshot({ snapshot }: { snapshot: EveryNodeSnapshot }) {
  const split = snapshot.islands.length > 1;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[#f0deca] bg-white p-4 dark:border-[#674632] dark:bg-[#211711]" aria-label={snapshot.title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-[#49200c] dark:text-[#fff0db]">{snapshot.title}</h3>
        {split ? (
          <ToneBadge tone="danger">✕ Split</ToneBadge>
        ) : (
          <ToneBadge tone={snapshot.allAgree ? "success" : "warning"}>{snapshot.allAgree ? "All agree" : "Disagree"}</ToneBadge>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {snapshot.tiles.map((tile) => (
          <li
            key={tile.node}
            className={cn(
              "flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-xl border px-3 py-2 text-sm",
              split ? ISLAND_CLASS[tile.island % ISLAND_CLASS.length] : "border-[#f2e5d7] dark:border-[#674632]",
            )}
          >
            <span className="font-medium text-[#49200c] dark:text-[#fff0db]">{tile.name.replace(/ agent$/, "")}</span>
            <span className="flex items-center gap-1.5">
              <span className={cn("text-xs", tile.status === "needs_human_review" ? "font-semibold text-orange-700 dark:text-orange-300" : "text-[#705342] dark:text-[#e5c7ad]")}>
                {capitalise(tile.statusLabel)}
              </span>
              <ToneBadge tone={priorityTone(tile.priority)}>{capitalise(tile.priorityLabel)}</ToneBadge>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EveryNodeDecides({ model }: { model: EveryNodeViewModel }) {
  return (
    <section aria-labelledby="every-node-heading" className={cn(NETWORK_CARD, "flex flex-col gap-4")}>
      <div>
        <p className={NETWORK_EYEBROW}>No central decider</p>
        <h2 id="every-node-heading" className="mt-1 text-xl font-semibold tracking-tight text-[#49200c] dark:text-[#fff0db]">
          Every agent can decide on its own
        </h2>
        <p className="mt-1 text-sm text-[#705342] dark:text-[#e5c7ad]">
          Each agent runs the same rules on the evidence it holds. Split apart, each side decides alone; reconnected, they agree again.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {model.snapshots.map((snapshot) => (
          <Snapshot key={snapshot.id} snapshot={snapshot} />
        ))}
      </div>
      <p className="text-sm font-medium text-[#49200c] dark:text-[#fff0db]">{model.summary}</p>
    </section>
  );
}
