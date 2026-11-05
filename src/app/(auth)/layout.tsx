import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Link className="text-center font-semibold" href={ROUTES.home}>
        {siteConfig.name}
      </Link>
      {children}
    </main>
  );
}
