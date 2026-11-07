import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { NotConfiguredNotice } from "@/components/not-configured-notice";
import { signIn } from "@/features/auth/actions";
import { AuthForm } from "@/features/auth/components/auth-form";
import { AuthPanel } from "@/features/auth/components/auth-panel";
import { safeRedirectPath } from "@/lib/routes";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const target = safeRedirectPath(next);
  if (await getCurrentUser()) redirect(target);

  return (
    <AuthPanel
      mode="sign-in"
      title="Welcome back"
      description="Sign in to review investigations, evidence and agent findings."
    >
      <NotConfiguredNotice />
      {error ? (
        <FormMessage variant="error">
          That confirmation link is invalid or has expired. Try signing in.
        </FormMessage>
      ) : null}
      <AuthForm mode="sign-in" action={signIn} next={target} />
    </AuthPanel>
  );
}
