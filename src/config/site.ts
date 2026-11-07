import { ROUTES } from "@/lib/routes";

/** Rename the product here on the day. */
export const siteConfig = {
  name: "EmberGap",
  description:
    "Wildfire-evidence investigation prototype: independent agents assess possible-fire reports for human review. Synthetic demo data; not an emergency alert service.",
  /** Links shown in the signed-in header. */
  nav: [
    { label: "Investigations", href: ROUTES.embergap },
    { label: "Account", href: ROUTES.account },
  ],
} as const;
