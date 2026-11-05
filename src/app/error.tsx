"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <EmptyState
        title="Something went wrong"
        description="The page could not load. Your data is safe, so try again."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
