import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvestigationView } from "@/components/embergap/dashboard/investigation-view";
import { getInvestigationForUser } from "@/lib/embergap/read/investigations";
import { requireUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Investigation" };

export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const now = new Date();
  const investigation = await getInvestigationForUser(id, user, now);
  if (!investigation) notFound();

  return <InvestigationView investigation={investigation} now={now} />;
}
