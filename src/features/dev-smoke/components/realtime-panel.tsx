"use client";

import { useState, useTransition } from "react";
import { FormMessage } from "@/components/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useTableChanges,
  type RealtimeStatus,
} from "@/lib/realtime/use-table-changes";
import type { Tables } from "@/lib/supabase/database.types";
import { createSmokeRecord } from "../actions";

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  error: "Connection failed",
};

export function RealtimePanel({ userId }: { userId: string }) {
  const [events, setEvents] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const status = useTableChanges<Tables<"dev_smoke_records">>({
    table: "dev_smoke_records",
    filter: `owner_id=eq.${userId}`,
    onChange: (payload) => {
      const title =
        payload.eventType === "DELETE" ? "(deleted)" : payload.new.title;
      setEvents((current) =>
        [`${payload.eventType}: ${title}`, ...current].slice(0, 20),
      );
    },
  });

  function handleInsert() {
    startTransition(async () => {
      const result = await createSmokeRecord(
        `Realtime test ${new Date().toISOString()}`,
      );
      setMessage(result.ok ? null : result.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          data-testid="realtime-status"
          variant={status === "error" ? "destructive" : "secondary"}
        >
          {STATUS_LABEL[status]}
        </Badge>
        <Button disabled={pending || status !== "live"} onClick={handleInsert}>
          Insert a test record
        </Button>
      </div>

      {message ? <FormMessage variant="error">{message}</FormMessage> : null}

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No events yet. Insert a record and it should appear here without a page
          reload.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 font-mono text-sm" data-testid="realtime-events">
          {events.map((event, index) => (
            <li key={`${index}-${event}`} className="break-all">
              {event}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
