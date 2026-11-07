import "server-only";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { EmbergapViewer } from "./repository";

/**
 * The signed-in EmberGap viewer, or null. Reviewer status comes from
 * app_metadata in the verified JWT, which users cannot edit (unlike
 * user_metadata). Grant it with the admin API:
 *   auth.admin.updateUserById(id, { app_metadata: { embergap_role: "reviewer" } })
 * It takes effect at the user's next sign-in or token refresh.
 */
export const getEmbergapViewer = cache(async (): Promise<EmbergapViewer | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const appMetadata = claims.app_metadata as Record<string, unknown> | undefined;
  return { userId: claims.sub, isReviewer: appMetadata?.embergap_role === "reviewer" };
});
