import { PageHeader } from "@/components/page-header";
import { RealtimePanel } from "@/features/dev-smoke/components/realtime-panel";
import { requireUser } from "@/lib/supabase/auth";

export default async function DevRealtimePage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title="Realtime"
        description="One channel, filtered to your own rows, closed when you leave this page."
      />
      <RealtimePanel userId={user.id} />
    </>
  );
}
