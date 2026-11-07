import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmberGapDashboard } from "./embergap-dashboard";
import { SafetyNotice } from "./notices";
import type { MapResponse } from "@/lib/embergap/contracts";
import type { MapRegion } from "@/lib/embergap/read/regions";

export function EvidenceWorkspace({
  regions,
  initialRegionId,
  initialData,
}: {
  regions: readonly MapRegion[];
  initialRegionId: string;
  initialData: MapResponse;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 lg:mx-[calc(50%-50vw+2rem)] lg:w-[calc(100vw-4rem)]">
      <section className="ember-workspace-hero rounded-[1.75rem] border border-[#f1d3b2] px-6 py-10 text-center sm:px-10 sm:py-14">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4">
          <span className="rounded-full border border-[#f3c798] bg-white/80 px-3 py-1 text-xs font-semibold tracking-wide text-[#9c3b08]">
            Evidence workspace
          </span>
          <h1 className="text-4xl font-medium tracking-[-0.045em] text-[#49200c] sm:text-5xl lg:text-6xl">
            A clearer view of <span className="text-[#b83d00]">wildfire evidence.</span>
          </h1>
          <p className="max-w-xl text-base leading-7 text-[#705342] sm:text-lg">
            Explore reports and satellite observations together. Evidence is unverified and intended for human review.
          </p>
          <Button asChild className="mt-1 h-11 rounded-xl bg-[#b83d00] px-6 text-white shadow-sm hover:bg-[#913000]">
            <Link href="/app/embergap/report">Report a possible fire <span aria-hidden="true">↗</span></Link>
          </Button>
        </div>
      </section>
      <SafetyNotice />
      <section aria-labelledby="evidence-map-heading" className="flex flex-col gap-4 rounded-[1.5rem] border border-[#f0deca] bg-[#fffefb] p-4 shadow-[0_12px_40px_rgba(100,47,10,0.06)] sm:p-6 dark:border-[#674632] dark:bg-[#2d2018]">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#f2e5d7] pb-4 dark:border-[#674632]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a34612] dark:text-[#ffbf88]">Explore the evidence</p>
            <h2 id="evidence-map-heading" className="mt-1 text-2xl font-semibold tracking-tight text-[#49200c] dark:text-[#fff0db]">Wildfire evidence map</h2>
          </div>
          <p className="text-sm text-[#705342] dark:text-[#e5c7ad]">Select an item to investigate</p>
        </div>
        <EmberGapDashboard regions={regions} initialRegionId={initialRegionId} initialData={initialData} />
      </section>
    </div>
  );
}
