import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { signOut } from "@/features/auth/actions";
import { ROUTES } from "@/lib/routes";

export function AppShell({
  userEmail,
  children,
}: {
  userEmail: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link className="font-semibold" href={ROUTES.dashboard}>
            {siteConfig.name}
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            {siteConfig.nav.map((item) => (
              <Link
                key={item.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
                href={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3 text-sm">
            {userEmail ? (
              <span
                className="max-w-48 truncate text-muted-foreground"
                data-testid="user-email"
              >
                {userEmail}
              </span>
            ) : null}
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
