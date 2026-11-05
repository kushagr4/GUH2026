import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";

/** Liveness only. It makes no database call, so it is free to poll. */
export function GET() {
  return NextResponse.json(
    { ok: true, supabaseConfigured: isSupabaseConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
