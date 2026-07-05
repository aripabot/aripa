export type DashboardTone = "default" | "success" | "danger" | "warning" | "info" | "muted";

const badgeToneClasses: Record<DashboardTone, string> = {
  default: "bg-muted text-foreground",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

const textToneClasses: Record<DashboardTone, string> = {
  default: "text-foreground",
  success: "text-emerald-600 dark:text-emerald-300",
  danger: "text-red-600 dark:text-red-300",
  warning: "text-amber-600 dark:text-amber-300",
  info: "text-sky-600 dark:text-sky-300",
  muted: "text-muted-foreground",
};

export function badgeToneClass(tone: DashboardTone): string {
  return badgeToneClasses[tone];
}

export function textToneClass(tone: DashboardTone): string {
  return textToneClasses[tone];
}
