import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { TONE_CLASS, type Tone } from "./labels";

export function ToneBadge({
  tone,
  children,
  className,
  title,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <Badge variant="outline" title={title} className={cn(TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}
