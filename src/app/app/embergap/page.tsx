import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
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
    { bbox: DEFAULT_REGION.bbox, limit: 100 },
    { repository: await getReadRepository() },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wildfire evidence map"
        description="Possible wildfire reports and satellite thermal anomalies, for human review. Nothing on this map is a confirmed fire."
        actions={
          <Button asChild>
            <Link href="/app/embergap/report">Report a possible fire</Link>
          </Button>
        }
      />
      <SafetyNotice />
      <EmberGapDashboard regions={DEMO_REGIONS} initialRegionId={DEFAULT_REGION.id} initialData={initialData} />
    </div>
  );
}
