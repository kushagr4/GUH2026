"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertDevAccess } from "./access";
import { createRecord, deleteRecord, updateRecord } from "./repository";

const titleSchema = z.string().trim().min(1, "Enter a title.").max(200);

export type SmokeActionResult = { ok: true } | { ok: false; message: string };

export async function createSmokeRecord(title: string): Promise<SmokeActionResult> {
  await assertDevAccess();
  const parsed = titleSchema.safeParse(title);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const result = await createRecord(await createClient(), { title: parsed.data });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath("/dev/records");
  return { ok: true };
}

export async function renameSmokeRecord(
  id: string,
  title: string,
): Promise<SmokeActionResult> {
  await assertDevAccess();
  const parsed = titleSchema.safeParse(title);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const result = await updateRecord(await createClient(), id, { title: parsed.data });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath("/dev/records");
  return { ok: true };
}

export async function deleteSmokeRecord(id: string): Promise<SmokeActionResult> {
  await assertDevAccess();
  const result = await deleteRecord(await createClient(), id);
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath("/dev/records");
  return { ok: true };
}
