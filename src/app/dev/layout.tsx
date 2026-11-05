import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isDevToolsEnabled } from "@/lib/env";
import { ROUTES } from "@/lib/routes";

// ENABLE_DEV_TOOLS is read per request, so this gate must never be prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Diagnostics",
  robots: { index: false, follow: false },
};

const TABS = [
  { label: "Status", href: "/dev" },
  { label: "Records", href: "/dev/records" },
  { label: "Storage", href: "/dev/storage" },
  { label: "Realtime", href: "/dev/realtime" },
  { label: "AI", href: "/dev/ai" },
];

export default function DevLayout({ children }: { children: ReactNode }) {
  if (!isDevToolsEnabled()) notFound();

  return (
    <div className="flex min-h-full flex-col">
      <div className="bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
        Development diagnostics. Not part of the product, and hidden in production.
      </div>
      <header className="border-b">
        <nav className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
              href={tab.href}
            >
              {tab.label}
            </Link>
          ))}
          <Link
            className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
            href={ROUTES.home}
          >
            Back to app
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
