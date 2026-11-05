import { PageHeader } from "@/components/page-header";
import { StoragePanel } from "@/features/dev-smoke/components/storage-panel";
import { requireUser } from "@/lib/supabase/auth";

export default async function DevStoragePage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title="Private storage"
        description="Upload to a private bucket, where each user can reach only their own folder."
      />
      <StoragePanel userId={user.id} />
    </>
  );
}
