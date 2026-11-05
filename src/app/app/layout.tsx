import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/** Every page under /app is signed-in only. Add product pages in this folder. */
export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  return <AppShell userEmail={user.email}>{children}</AppShell>;
}
