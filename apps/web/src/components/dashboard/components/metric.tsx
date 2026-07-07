"use client";

import { formatCount } from "@/components/dashboard/lib/format";

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{formatCount(value)}</p>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
