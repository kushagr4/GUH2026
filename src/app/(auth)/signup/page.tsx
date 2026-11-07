import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotConfiguredNotice } from "@/components/not-configured-notice";
import { signUp } from "@/features/auth/actions";
import { AuthForm } from "@/features/auth/components/auth-form";
import { AuthPanel } from "@/features/auth/components/auth-panel";
import { ROUTES } from "@/lib/routes";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect(ROUTES.dashboard);

  return (
    <AuthPanel
      mode="sign-up"
      title="Create your account"
      description="Submit possible-fire observations and follow how independent agents assess them."
    >
      <NotConfiguredNotice />
      <AuthForm mode="sign-up" action={signUp} />
    </AuthPanel>
  );
}
