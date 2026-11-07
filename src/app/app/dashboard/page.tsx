import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

/** The starter dashboard is replaced by EmberGap's investigations page. Kept as a redirect so old links work. */
export default function DashboardPage() {
  redirect(ROUTES.embergap);
}
