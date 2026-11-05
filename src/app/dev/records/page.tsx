import { PageHeader } from "@/components/page-header";
import { RecordsPanel } from "@/features/dev-smoke/components/records-panel";
import { listRecords } from "@/features/dev-smoke/repository";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DevRecordsPage() {
  await requireUser();
  const result = await listRecords(await createClient());

  return (
    <>
      <PageHeader
        title="Protected records"
        description="Create, rename and delete rows in an owner-scoped smoke table."
      />
      {result.ok ? (
        <RecordsPanel records={result.data} />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {result.error.message}
        </p>
      )}
    </>
  );
}
