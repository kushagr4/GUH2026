import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { signOut } from "@/features/auth/actions";

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
          <Link
            className="inline-flex items-center gap-2 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
            href="/app/embergap"
            aria-label="EmberGap home"
          >
            <span className="ember-logo-flame" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none" width="30" height="30">
                <path className="ember-logo-outer" d="M17.3 2.7c.5 4-2.5 5.8-2 9.2-2-1-2.6-3-2.6-4.1C8.5 11 5.5 15 5.5 20.2 5.5 26 10 30 16 30s10.5-4 10.5-9.8c0-6.9-4.6-11.9-9.2-17.5Z" fill="#ff6b00" />
                <path className="ember-logo-inner" d="M16.1 14c.3 2.5-1.7 3.8-1.6 5.8-1.1-.5-1.6-1.5-1.6-2.3-1.8 1.5-3 3.6-3 5.7 0 3.8 2.6 6.1 6.1 6.1s6.1-2.3 6.1-6.1c0-3.4-2.2-6.2-6-9.2Z" fill="#ffd000" />
                <path className="ember-logo-core" d="M16.2 21c.1 1.3-.9 2-1.1 3.2-.4-.3-.7-.7-.8-1.1-.8.8-1.3 1.7-1.3 2.7 0 1.9 1.4 3 3.1 3s3.1-1.2 3.1-3c0-1.7-1.1-3.3-3-4.8Z" fill="#fff5b2" />
              </svg>
            </span>
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
