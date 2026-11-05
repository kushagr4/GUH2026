import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormMessage({
  variant,
  children,
}: {
  variant: "error" | "success";
  children: ReactNode;
}) {
  return (
    <Alert
      variant={variant === "error" ? "destructive" : "default"}
      aria-live="polite"
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
