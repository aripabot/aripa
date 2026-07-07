import type * as React from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "ok" | "warning" | "danger" | "neutral";

const dotToneClasses: Record<StatusTone, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-muted-foreground/40",
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", dotToneClasses[tone], className)}
    />
  );
}

export function StatusText({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}
