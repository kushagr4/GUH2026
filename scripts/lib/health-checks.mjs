const TIMEOUT_MS = 8000;

async function probe(url, key) {
  const started = Date.now();
  const response = await fetch(url, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { response, ms: Date.now() - started };
}

const PAUSED_HINT =
  "Free projects pause after a week without activity. Check the Supabase dashboard and restore it if needed.";

/**
 * A handful of very small requests using only the publishable key, so it is safe
 * for any teammate to run. Nothing here reads or writes real rows.
 */
export async function runHealthChecks(url, key) {
  const base = url.replace(/\/+$/, "");
  const results = [];

  try {
    const { response, ms } = await probe(`${base}/auth/v1/health`, key);
    results.push({
      name: "Auth",
      ok: response.ok,
      detail: response.ok ? `${ms} ms` : `HTTP ${response.status}. ${PAUSED_HINT}`,
    });
  } catch {
    results.push({
      name: "Auth",
      ok: false,
      detail: `Could not reach the project. Check your network. ${PAUSED_HINT}`,
    });
    return results;
  }

  // Anonymous access to this table must be refused. A refusal proves both that
  // the database answered and that anon has no access, and it reads zero rows.
  const { response, ms } = await probe(
    `${base}/rest/v1/profiles?select=id&limit=0`,
    key,
  );
  const body = await response.json().catch(() => null);
  if (response.status === 401 || body?.code === "42501") {
    results.push({
      name: "Database",
      ok: true,
      detail: `${ms} ms, anonymous access refused as expected`,
    });
  } else if (body?.code === "PGRST205") {
    results.push({
      name: "Database",
      ok: false,
      detail: "Connected, but the migrations have not been applied (npm run db:push).",
    });
  } else if (response.ok) {
    results.push({
      name: "Database",
      ok: false,
      detail: "SECURITY PROBLEM: anonymous access to public.profiles was allowed.",
    });
  } else {
    results.push({
      name: "Database",
      ok: false,
      detail: `HTTP ${response.status}${body?.code ? `, ${body.code}` : ""}`,
    });
  }

  const storage = await probe(`${base}/storage/v1/version`, key).catch(() => null);
  results.push({
    name: "Storage",
    ok: Boolean(storage?.response.ok),
    detail: storage?.response.ok
      ? `${storage.ms} ms`
      : `Unexpected response (${storage?.response.status ?? "no response"}).`,
  });

  return results;
}
