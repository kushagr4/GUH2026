import { ROUTES } from "@/lib/routes";

/** Rename the product here on the day. */
export const siteConfig = {
  name: "GUH2026 Starter",
  description: "A reusable foundation for building and demoing a web app quickly.",
  /** Links shown in the signed-in header. */
  nav: [
    { label: "Dashboard", href: ROUTES.dashboard },
    { label: "Account", href: ROUTES.account },
  ],
} as const;
