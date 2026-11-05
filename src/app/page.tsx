import Link from "next/link";
import { redirect } from "next/navigation";
import { NotConfiguredNotice } from "@/components/not-configured-notice";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { isDevToolsEnabled } from "@/lib/env";
import { ROUTES } from "@/lib/routes";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (await getCurrentUser()) redirect(ROUTES.dashboard);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          {siteConfig.name}
        </h1>
        <p className="text-lg text-pretty text-muted-foreground">
          {siteConfig.description}
        </p>
      </div>

      <NotConfiguredNotice />

      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href={ROUTES.signup}>Create an account</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={ROUTES.login}>Sign in</Link>
        </Button>
        {isDevToolsEnabled() ? (
          <Button asChild size="lg" variant="ghost">
            <Link href={ROUTES.dev}>Diagnostics</Link>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
