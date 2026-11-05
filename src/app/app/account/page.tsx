import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileForm } from "@/features/account/components/profile-form";
import { getOwnProfile } from "@/features/account/repository";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  const profile = await getOwnProfile(await createClient(), user.id);

  return (
    <>
      <PageHeader title="Account" description={user.email ?? undefined} />
      <Card className="max-w-md">
        <CardContent>
          {profile.ok ? (
            <ProfileForm displayName={profile.data?.display_name ?? ""} />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {profile.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
