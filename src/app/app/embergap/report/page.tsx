import type { Metadata } from "next";
import Link from "next/link";
import { SafetyNotice } from "@/components/embergap/dashboard/notices";
import { ReportForm } from "@/components/embergap/report/report-form";
import { requireUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Report a possible fire" };

export default async function ReportPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/app/embergap" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Back to the map
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Report a possible fire</h1>
      </div>
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      >
        <p className="font-semibold">If anyone is in immediate danger, call 112 now (EU emergency number). In Italy you can also call 115 (Vigili del Fuoco).</p>
        <p className="mt-1">
          This app does not contact emergency services. Report only from a safe place; never approach a fire to take a
          photo.
        </p>
      </div>
      <SafetyNotice />
      <ReportForm userId={user.id} />
    </div>
  );
}
