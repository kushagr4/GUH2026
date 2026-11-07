import type { Metadata } from "next";
import { EvidenceWorkspace } from "@/components/embergap/dashboard/evidence-workspace";
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

  return <EvidenceWorkspace regions={DEMO_REGIONS} initialRegionId={DEFAULT_REGION.id} initialData={initialData} />;
}
