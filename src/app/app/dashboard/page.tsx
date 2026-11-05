import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={user.email ? `Signed in as ${user.email}` : undefined}
      />
      <EmptyState
        title="Nothing here yet"
        description="This is the signed-in home page. Replace it with your product's first screen."
      />
    </>
  );
}
