"use client";

import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
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
    let channel: RealtimeChannel | undefined;
    let active = true;

    // Realtime applies RLS using the token sent when the channel joins. The
    // browser client loads the session from cookies asynchronously, so without
    // this the join can go out with only the publishable key. The server then
    // treats the subscriber as anon and RLS hides every change.
    supabase.realtime
      .setAuth()
      .then(() => {
        if (!active) return;
        channel = supabase
          .channel(`${schema}:${table}:${instanceId}`, {
            // Report "live" only once the server confirms the subscription,
            // and an error (not "live") if it refuses it.
            config: { postgres_changes_options: { wait: true } },
          })
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
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
      setStatus("idle");
    };
  }, [enabled, filter, instanceId, schema, table]);

  return enabled && status === "idle" ? "connecting" : status;
}
