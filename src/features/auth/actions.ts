"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ROUTES, safeRedirectPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { friendlyAuthError } from "./errors";
import { signInSchema, signUpSchema, type AuthFormState } from "./schemas";

const NOT_CONFIGURED: AuthFormState = {
  status: "error",
  message: "Supabase is not configured yet. See the README to set up .env.local.",
};

export async function signIn(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "error", message: friendlyAuthError(error) };

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signUp(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: origin ? { emailRedirectTo: `${origin}/auth/callback` } : undefined,
  });
  if (error) return { status: "error", message: friendlyAuthError(error) };

  // With "Confirm email" off (the recommended setting for this project) a session
  // comes back straight away. With it on, the user has to click the email link.
  if (!data.session) {
    return {
      status: "check-email",
      message: "Check your email for a confirmation link, then sign in.",
    };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect(ROUTES.login);
}
