import "server-only";
import { REPORT_MEDIA_BUCKET } from "@/lib/embergap/contracts";
import { getFirmsMode } from "@/lib/embergap/sources/firms/client";
import { canRunAgents } from "./orchestrator";
import type { EmbergapClient } from "./repository";

/** PostgREST and Postgres codes for "that table or function does not exist". */
export const MISSING_SCHEMA_CODES = new Set(["PGRST205", "PGRST202", "42P01", "42883"]);

export type Check = { ok: boolean; detail: string };

export type EmbergapStatus = {
  ok: boolean;
  database: Record<"reports" | "investigations" | "agent_findings" | "photo_bucket", Check>;
  agents: Check;
  satellites: Check;
  fix: string[];
};

/**
 * What a signed-in user's report submission depends on, checked with their own
 * RLS client (no secret key, no data returned): the EmberGap tables and photo
 * bucket exist, agents can run, and which satellite data is in use.
 */
export async function getEmbergapStatus(client: EmbergapClient, userId: string): Promise<EmbergapStatus> {
  const table = async (name: "reports" | "investigations" | "agent_findings"): Promise<Check> => {
    const { error } = await client.from(name).select("id", { head: true, count: "exact" }).limit(1);
    if (!error) return { ok: true, detail: "reachable" };
    if (MISSING_SCHEMA_CODES.has(error.code ?? "")) return { ok: false, detail: `missing (${error.code}): the EmberGap migrations are not applied` };
    return { ok: false, detail: `error ${error.code ?? "unknown"}` };
  };
  const [reports, investigations, findings] = await Promise.all([table("reports"), table("investigations"), table("agent_findings")]);
  const bucket = await client.storage.from(REPORT_MEDIA_BUCKET).list(userId, { limit: 1 });
  const photoBucket: Check = bucket.error
    ? { ok: false, detail: /not found/i.test(bucket.error.message) ? "missing: the EmberGap migrations are not applied" : "error" }
    : { ok: true, detail: "reachable" };
  const agents: Check = canRunAgents()
    ? { ok: true, detail: "SUPABASE_SECRET_KEY is set: agents run after each report" }
    : { ok: false, detail: "SUPABASE_SECRET_KEY is not set: reports save, but agents never run" };
  const live = getFirmsMode() === "live";
  const satellites: Check = { ok: true, detail: live ? "live NASA FIRMS" : "synthetic demo detections (set NASA_FIRMS_MAP_KEY for live)" };

  const database = { reports, investigations, agent_findings: findings, photo_bucket: photoBucket };
  const fix: string[] = [];
  if (Object.values(database).some((check) => check.detail.includes("migrations are not applied"))) {
    fix.push("Apply the migrations to the hosted project as the migration owner: npm run db:push, then npm run db:types -- --check.");
  }
  if (!agents.ok) fix.push("Add SUPABASE_SECRET_KEY to the Vercel project's environment variables (Sensitive) and redeploy.");
  return { ok: Object.values(database).every((check) => check.ok) && agents.ok, database, agents, satellites, fix };
}
