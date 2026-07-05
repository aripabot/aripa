"use client";

import { formatCount } from "@/components/dashboard/lib/format";

type LogMetricTone = "default" | "warn" | "error";

const logMetricToneClasses: Record<LogMetricTone, string> = {
  default: "text-foreground",
  warn: "text-amber-600 dark:text-amber-300",
  error: "text-red-600 dark:text-red-300",
};

export function LogMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: LogMetricTone;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${logMetricToneClasses[tone]}`}>
        {formatCount(value)}
      </p>
    </div>
  );
}
