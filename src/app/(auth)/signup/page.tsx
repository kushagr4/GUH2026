import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotConfiguredNotice } from "@/components/not-configured-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signUp } from "@/features/auth/actions";
import { AuthForm } from "@/features/auth/components/auth-form";
import { ROUTES } from "@/lib/routes";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect(ROUTES.dashboard);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create an account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <NotConfiguredNotice />
        <AuthForm mode="sign-up" action={signUp} />
      </CardContent>
    </Card>
  );
}
