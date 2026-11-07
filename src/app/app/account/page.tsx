import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { ProfileForm } from "@/features/account/components/profile-form";
import { getOwnProfile } from "@/features/account/repository";
import { signOut } from "@/features/auth/actions";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

/** Warm card surface shared with the evidence workspace (#30). */
const CARD =
  "w-full rounded-[1.5rem] border border-[#f0deca] bg-[#fffefb] p-6 shadow-[0_12px_40px_rgba(100,47,10,0.06)] dark:border-[#674632] dark:bg-[#2d2018]";
const EYEBROW = "text-xs font-semibold uppercase tracking-[0.14em] text-[#a34612] dark:text-[#ffbf88]";
const TITLE = "text-xl font-semibold tracking-tight text-[#49200c] dark:text-[#fff0db]";

export default async function AccountPage() {
  const user = await requireUser();
  const profile = await getOwnProfile(await createClient(), user.id);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5">
      <section className="ember-workspace-hero flex w-full flex-col items-center gap-3 rounded-[1.75rem] border border-[#f1d3b2] px-6 py-10 text-center">
        <span className="rounded-full border border-[#f3c798] bg-white/80 px-3 py-1 text-xs font-semibold tracking-wide text-[#9c3b08]">
          Your account
        </span>
        <h1 className="text-4xl font-medium tracking-[-0.045em] text-[#49200c]">
          Account <span className="text-[#b83d00]">settings</span>
        </h1>
        {user.email ? <p className="text-base text-[#705342]">{user.email}</p> : null}
      </section>

      <section aria-labelledby="profile-heading" className={CARD}>
        <p className={EYEBROW}>Profile</p>
        <h2 id="profile-heading" className={`mt-1 ${TITLE}`}>
          How you appear
        </h2>
        <div className="mt-4">
          {profile.ok ? (
            <ProfileForm displayName={profile.data?.display_name ?? ""} />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {profile.error.message}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="session-heading" className={CARD}>
        <p className={EYEBROW}>Session</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="session-heading" className={TITLE}>
              Signed in
            </h2>
            {user.email ? (
              <p className="truncate text-sm text-[#705342] dark:text-[#e5c7ad]">{user.email}</p>
            ) : null}
          </div>
          <form action={signOut}>
            <Button
              type="submit"
              variant="outline"
              className="h-10 rounded-xl border-[#f0deca] px-4 text-[#71513d] hover:bg-[#fff0df] hover:text-[#a33300] dark:border-[#674632] dark:text-[#edd6c1]"
            >
              Sign out
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
