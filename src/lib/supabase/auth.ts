import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { ROUTES } from "@/lib/routes";
import { createClient } from "./server";

export type CurrentUser = {
  id: string;
  email: string | null;
};

/**
 * The verified user for this request, or null. `cache` means repeated calls in
 * one render make a single auth check, which keeps free-plan usage low.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const email = data.claims.email;
  return {
    id: data.claims.sub,
    email: typeof email === "string" ? email : null,
  };
});

/** Use at the top of protected pages and Server Actions. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(ROUTES.login);
  return user;
}
