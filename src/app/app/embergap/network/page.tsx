import type { Metadata } from "next";
import { NetworkView } from "@/components/embergap/network/network-view";
import { buildNetworkViewModel, stageSnapshotTimes, type StageId } from "@/components/embergap/network/view-model";
import { runPartitionDemo } from "@/lib/embergap/agents/runtime";
import { requireUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "EmberGap agent network" };

export default async function EmberGapNetworkPage() {
  await requireUser();
  // In memory only: runPartitionDemo defaults to a memory store, so this page writes nothing.
  const full = await runPartitionDemo();
  const times = stageSnapshotTimes(full);
  const replays: Partial<Record<StageId, Awaited<ReturnType<typeof runPartitionDemo>>>> = {};
  // The same seed replays to exactly the same state, so each stage is a real snapshot.
  for (const stage of full.stages) {
    const id = stage.stage as StageId;
    replays[id] = id === "reconciled" ? full : await runPartitionDemo({ stopAtMs: times[id] });
  }
  const model = buildNetworkViewModel(full, replays);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-orange-700 dark:text-orange-300">Simulation · synthetic data</p>
        <h1 className="text-3xl font-semibold tracking-tight">Agent network</h1>
        <p className="text-lg">
          Four independent agents investigate a possible fire reported on the vineyard slopes of Mount Etna, Sicily (Report A). A second
          report, from the Salento vineyards in Puglia (Report B), arrives while the network is split. Watch what each agent knows, and how
          they catch up when the links come back.
        </p>
        <p className="text-sm text-muted-foreground">
          In-process simulation of a partitionable agent network; not a deployed multi-machine system. Outputs are review recommendations for a
          human, not verified incidents.
        </p>
      </header>
      <NetworkView model={model} />
    </div>
  );
}
