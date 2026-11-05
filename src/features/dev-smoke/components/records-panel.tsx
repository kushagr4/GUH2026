"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createSmokeRecord,
  deleteSmokeRecord,
  renameSmokeRecord,
  type SmokeActionResult,
} from "../actions";
import type { SmokeRecord } from "../repository";

export function RecordsPanel({ records }: { records: SmokeRecord[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<SmokeActionResult>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage(null);
        onDone?.();
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    run(
      () => createSmokeRecord(title),
      () => setTitle(""),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap gap-2" onSubmit={handleCreate}>
        <Input
          aria-label="New record title"
          className="min-w-48 flex-1"
          maxLength={200}
          name="title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Record title"
          required
          value={title}
        />
        <Button disabled={pending} type="submit">
          Add record
        </Button>
      </form>

      {message ? <FormMessage variant="error">{message}</FormMessage> : null}

      {records.length === 0 ? (
        <EmptyState
          title="No records yet"
          description="Add one above. Only you can see the records you create."
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="records">
          {records.map((record) => (
            <li
              key={record.id}
              className="flex flex-wrap items-center gap-2 px-4 py-3"
              data-testid="record-row"
            >
              <span className="min-w-0 flex-1 break-words">{record.title}</span>
              <Button
                disabled={pending}
                onClick={() => {
                  const next = window.prompt("New title", record.title);
                  if (next) run(() => renameSmokeRecord(record.id, next));
                }}
                size="sm"
                variant="outline"
              >
                Rename
              </Button>
              <ConfirmDialog
                description="This permanently removes the smoke record."
                onConfirm={() => run(() => deleteSmokeRecord(record.id))}
                title="Delete this record?"
                trigger={
                  <Button disabled={pending} size="sm" variant="outline">
                    Delete
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
