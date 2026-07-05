"use client";

import { formatCount } from "@/components/dashboard/lib/format";
import { textToneClass } from "@/components/dashboard/lib/tone";

type LogMetricTone = "default" | "warn" | "error";

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
      <p className={`mt-2 text-2xl font-semibold ${logMetricToneClass(tone)}`}>
        {formatCount(value)}
      </p>
    </div>
  );
}

function logMetricToneClass(tone: LogMetricTone): string {
  switch (tone) {
    case "default":
      return textToneClass("default");
    case "warn":
      return textToneClass("warning");
    case "error":
      return textToneClass("danger");
  }
}
