import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmberGapDashboard } from "@/components/embergap/dashboard/embergap-dashboard";
import { SafetyNotice } from "@/components/embergap/dashboard/notices";
import { getMapData } from "@/lib/embergap/read/map";
import { DEFAULT_REGION, DEMO_REGIONS } from "@/lib/embergap/read/regions";
import { getReadRepository } from "@/lib/embergap/read/repository";
import { requireUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "EmberGap map" };

export default async function EmberGapPage() {
  await requireUser();
  const initialData = await getMapData(
    { bbox: DEFAULT_REGION.bbox, limit: 200 },
    { repository: await getReadRepository() },
  );

  return (
    // Wider than the shared 1024px shell: the map gets the whole viewport width.
    <div className="mx-[calc(50%-50vw+1rem)] -mt-2 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Wildfire evidence map</h1>
        <Button asChild size="sm">
          <Link href="/app/embergap/report">Report a possible fire</Link>
        </Button>
      </div>
      <SafetyNotice />
      <EmberGapDashboard regions={DEMO_REGIONS} initialRegionId={DEFAULT_REGION.id} initialData={initialData} />
    </div>
  );
}
