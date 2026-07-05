"use client";

import type { LucideIcon } from "lucide-react";

import { textToneClass } from "@/components/dashboard/lib/tone";

export function ResponsiveDatum({
  label,
  value,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "muted";
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase text-muted-foreground lg:hidden">{label}</p>
      <p
        className={`mt-1 flex min-w-0 items-center gap-2 truncate text-sm lg:mt-0 ${textToneClass(tone)}`}
      >
        {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
        <span className="truncate">{value}</span>
      </p>
    </div>
  );
}

export function RuntimeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}
