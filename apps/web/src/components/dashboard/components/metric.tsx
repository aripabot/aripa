"use client";

import { formatCount } from "@/components/dashboard/lib/format";

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal">{formatCount(value)}</p>
      <p className="mt-1 h-5 text-sm text-muted-foreground" aria-hidden="true" />
    </div>
  );
}
