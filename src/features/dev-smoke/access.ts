import "server-only";
import { notFound } from "next/navigation";
import { isDevToolsEnabled } from "@/lib/env";
import { requireUser, type CurrentUser } from "@/lib/supabase/auth";

/**
 * Server Actions are public POST endpoints, so each one repeats the page's gate.
 * Kept out of the "use server" files, where every export becomes an endpoint.
 */
export async function assertDevAccess(): Promise<CurrentUser> {
  if (!isDevToolsEnabled()) notFound();
  return requireUser();
}
