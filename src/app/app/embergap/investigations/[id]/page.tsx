import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvestigationView } from "@/components/embergap/dashboard/investigation-view";
import { getInvestigationDetail } from "@/lib/embergap/read/investigations";
import { getReadRepository } from "@/lib/embergap/read/repository";
import { requireUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Investigation" };

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const lookup = await getInvestigationDetail(id, await getReadRepository());
  if (lookup.kind === "not_found") notFound();
  if (lookup.kind === "error") throw new Error("The investigation is unavailable. Try again shortly.");

  return <InvestigationView detail={lookup.data} />;
}
