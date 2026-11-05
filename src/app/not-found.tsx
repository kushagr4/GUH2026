import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <EmptyState
        title="Page not found"
        description="That page does not exist or has moved."
        action={
          <Button asChild variant="outline">
            <Link href={ROUTES.home}>Go home</Link>
          </Button>
        }
      />
    </main>
  );
}
