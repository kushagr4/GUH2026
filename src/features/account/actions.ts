"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROUTES } from "@/lib/routes";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOwnProfile } from "./repository";

export type ProfileFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

const profileSchema = z.object({
  displayName: z.string().trim().max(80, "Use 80 characters or fewer."),
});

export async function updateProfile(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const result = await saveOwnProfile(await createClient(), user.id, {
    display_name: parsed.data.displayName || null,
  });
  if (!result.ok) return { status: "error", message: result.error.message };

  revalidatePath(ROUTES.account);
  return { status: "saved" };
}
