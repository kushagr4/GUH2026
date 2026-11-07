import type { Metadata } from "next";
import { buildEveryNodeViewModel } from "@/components/embergap/network/decentralised-view-model";
import { EveryNodeDecides } from "@/components/embergap/network/every-node-decides";
import { NETWORK_EYEBROW } from "@/components/embergap/network/network-styles";
import { NetworkView } from "@/components/embergap/network/network-view";
import { createDeterministicDeps, DECENTRALISED_SCENARIOS, simulateDecentralisedFusion } from "@/lib/embergap/agents/fusion";
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
  const headline = DECENTRALISED_SCENARIOS[0];
  const everyNode = buildEveryNodeViewModel(
    simulateDecentralisedFusion(headline.input, createDeterministicDeps("network-page")),
    headline.input.links,
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className={NETWORK_EYEBROW}>How the agents work together</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[#49200c] dark:text-[#fff0db]">Agent network</h1>
        <p className="max-w-3xl text-base leading-7 text-[#705342] dark:text-[#e5c7ad]">
          Four agents investigate a possible fire on Mount Etna&apos;s vineyards (Report A). Midway, the network splits and a second report
          arrives from Puglia (Report B). Step through to see each agent keep working, then catch up.
        </p>
      </header>
      <NetworkView model={model} />
      <EveryNodeDecides model={everyNode} />
    </div>
  );
}
