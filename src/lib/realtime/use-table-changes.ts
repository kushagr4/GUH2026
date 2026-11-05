"use client";

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type RealtimeStatus = "idle" | "connecting" | "live" | "error";

type Options<Row extends Record<string, unknown>> = {
  table: string;
  schema?: string;
  /** PostgREST-style filter, for example `owner_id=eq.<uuid>`. Strongly recommended. */
  filter?: string;
  /** Pass false until you have what you need, such as the user id. */
  enabled?: boolean;
  onChange: (payload: RealtimePostgresChangesPayload<Row>) => void;
};

/**
 * Subscribes one component to one table and always cleans up on unmount.
 * Free plan: 200 concurrent connections and 2M messages a month, so subscribe
 * only on pages that show live data and always pass a filter when you can.
 */
export function useTableChanges<Row extends Record<string, unknown>>({
  table,
  schema = "public",
  filter,
  enabled = true,
  onChange,
}: Options<Row>): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const callback = useRef(onChange);
  const instanceId = useId();

  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`${schema}:${table}:${instanceId}`)
      .on<Row>(
        "postgres_changes",
        { event: "*", schema, table, ...(filter ? { filter } : {}) },
        (payload) => callback.current(payload),
      )
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setStatus("live");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          setStatus("error");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      setStatus("idle");
    };
  }, [enabled, filter, instanceId, schema, table]);

  return enabled && status === "idle" ? "connecting" : status;
}
