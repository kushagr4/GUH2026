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
    <div className="relative left-1/2 flex w-[calc(100vw-2rem)] max-w-[1440px] -translate-x-1/2 flex-col gap-5 sm:w-[calc(100vw-4rem)]">
      <SafetyNotice />
      <section aria-labelledby="evidence-map-heading" className="flex flex-col gap-4 rounded-[1.5rem] border border-[#f0deca] bg-[#fffefb] p-4 shadow-[0_12px_40px_rgba(100,47,10,0.06)] sm:p-6 dark:border-[#674632] dark:bg-[#2d2018]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f2e5d7] pb-4 dark:border-[#674632]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a34612] dark:text-[#ffbf88]">Explore the evidence</p>
            <h1 id="evidence-map-heading" className="mt-1 text-2xl font-semibold tracking-tight text-[#49200c] dark:text-[#fff0db]">Wildfire evidence map</h1>
          </div>
          <Button asChild className="h-11 rounded-xl bg-[#b83d00] px-6 text-white shadow-sm hover:bg-[#913000]">
            <Link href="/app/embergap/report">Report a possible fire <span aria-hidden="true">↗</span></Link>
          </Button>
        </div>
        <EmberGapDashboard regions={regions} initialRegionId={initialRegionId} initialData={initialData} />
      </section>
    </div>
  );
}
