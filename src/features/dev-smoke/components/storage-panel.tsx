"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ownerObjectPath, validateUpload } from "@/lib/storage/uploads";
import { createClient } from "@/lib/supabase/client";

// These mirror the bucket's server-side limits in the dev_smoke migration.
const BUCKET = "dev-smoke-private";
const MAX_BYTES = 1024 * 1024;
const ALLOWED_TYPES = ["text/plain", "image/png", "application/json"];

type StoredFile = { name: string };

function listFiles(userId: string) {
  return createClient()
    .storage.from(BUCKET)
    .list(userId, { limit: 20, sortBy: { column: "created_at", order: "desc" } });
}

/**
 * Uploads go straight from the browser to Storage with the user's session, so
 * bucket RLS and limits apply and no file passes through the Next.js server.
 */
export function StoragePanel({ userId }: { userId: string }) {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await listFiles(userId);
    if (error) setMessage("Could not list your files.");
    else setFiles(data ?? []);
  }, [userId]);

  useEffect(() => {
    let active = true;
    listFiles(userId).then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage("Could not list your files.");
      else setFiles(data ?? []);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    const check = validateUpload(file, {
      maxBytes: MAX_BYTES,
      allowedTypes: ALLOWED_TYPES,
    });
    if (!check.ok) {
      setMessage(check.message);
      input.value = "";
      return;
    }

    setBusy(true);
    const { error } = await createClient()
      .storage.from(BUCKET)
      .upload(ownerObjectPath(userId, file.name), file, {
        contentType: file.type,
      });
    setBusy(false);
    input.value = "";

    if (error) {
      setMessage("Upload failed. Check the file's size and type.");
      return;
    }
    setMessage(null);
    await refresh();
  }

  async function handleOpen(name: string) {
    // Short-lived link, because the bucket is private and has no public URLs.
    const { data, error } = await createClient()
      .storage.from(BUCKET)
      .createSignedUrl(`${userId}/${name}`, 60);
    if (error || !data) setMessage("Could not create a link for that file.");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleDelete(name: string) {
    const { error } = await createClient()
      .storage.from(BUCKET)
      .remove([`${userId}/${name}`]);
    if (error) {
      setMessage("Could not delete that file.");
      return;
    }
    setMessage(null);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="smoke-file">
          Upload a small test file (text, PNG or JSON, up to 1 MB)
        </Label>
        <Input
          accept={ALLOWED_TYPES.join(",")}
          disabled={busy}
          id="smoke-file"
          onChange={handleUpload}
          type="file"
        />
      </div>

      {message ? <FormMessage variant="error">{message}</FormMessage> : null}

      {files.length === 0 ? (
        <EmptyState
          title="No files yet"
          description="Files are private to your account and stored under your user id."
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" data-testid="files">
          {files.map((file) => (
            <li
              key={file.name}
              className="flex flex-wrap items-center gap-2 px-4 py-3"
              data-testid="file-row"
            >
              <span className="min-w-0 flex-1 truncate">
                {file.name.slice(37)}
              </span>
              <Button
                onClick={() => handleOpen(file.name)}
                size="sm"
                variant="outline"
              >
                Open
              </Button>
              <ConfirmDialog
                onConfirm={() => handleDelete(file.name)}
                title="Delete this file?"
                trigger={
                  <Button size="sm" variant="outline">
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
