"use client";

export function ResponsiveDatum({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground lg:hidden">{label}</p>
      <p
        className={`mt-0.5 truncate text-sm lg:mt-0 ${
          tone === "muted" ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function RuntimeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm">{value}</p>
    </div>
  );
}
