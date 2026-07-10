"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type * as React from "react";
import { LogOut, Moon, Sun } from "lucide-react";

import { ErrorPanel } from "@/components/dashboard/components/panels";
import { StatusDot } from "@/components/dashboard/components/status-dot";
import { DashboardOnboardingScreen } from "@/components/dashboard/dashboard-onboarding-screen";
import { useLoadState } from "@/components/dashboard/hooks/use-load-state";
import { Button } from "@/components/ui/button";
import { getStatus } from "@/lib/api";
import type { CompleteOnboardingResponse, DashboardStatus } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import type { LoadState } from "@/server/dashboard-page-data";

export type View = "overview" | "traces" | "logs" | "updates" | "docker-deployments" | "settings";
type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface DashboardShellRenderContext {
  statusState: LoadState<DashboardStatus>;
  refreshStatus: () => Promise<void>;
  setStatusState: React.Dispatch<React.SetStateAction<LoadState<DashboardStatus>>>;
}

const views: Array<{ id: View; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/" },
  { id: "traces", label: "Traces", href: "/traces" },
  { id: "logs", label: "Logs", href: "/logs" },
  { id: "updates", label: "Updates", href: "/updates" },
  { id: "docker-deployments", label: "Docker", href: "/docker-deployments" },
  { id: "settings", label: "Settings", href: "/settings" },
];

export function DashboardShell({
  children,
  initialStatus,
  view,
}: {
  children: (context: DashboardShellRenderContext) => React.ReactNode;
  initialStatus?: LoadState<DashboardStatus>;
  view: View;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const {
    state: statusState,
    refresh: refreshStatus,
    setState: setStatusState,
  } = useLoadState(getStatus, initialStatus);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");
  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;
  const activeHref = pendingHref ?? pathname;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  function markNavigationPending(href: string, event: React.MouseEvent<HTMLAnchorElement>): void {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      href === pathname
    ) {
      return;
    }

    setPendingHref(href);
  }

  function completeFirstRun(result: CompleteOnboardingResponse): void {
    setStatusState((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        error: null,
        data: {
          ...current.data,
          appName: result.config.name,
          configPath: result.path,
          configExists: true,
          config: result.config,
        },
      };
    });
    router.refresh();
  }

  if (statusState.status === "ready" && !statusState.data.configExists) {
    return (
      <DashboardOnboardingScreen
        initialStatus={statusState.data}
        onComplete={completeFirstRun}
        onSignOut={() => void signOut()}
      />
    );
  }

  const runtime = statusState.status === "ready" ? statusState.data.botRuntime : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen w-full max-w-[88rem] lg:grid-cols-[13.5rem_1fr]">
        <aside
          className="min-w-0 border-b lg:border-b-0 lg:border-r"
          style={{ viewTransitionName: "dashboard-sidebar" } as React.CSSProperties}
        >
          <div className="flex h-full flex-col gap-6 px-4 py-4 lg:sticky lg:top-0 lg:max-h-screen lg:px-4 lg:py-6">
            <div className="flex items-center justify-between gap-3">
              <Link
                href="/"
                className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(event) => markNavigationPending("/", event)}
              >
                <img
                  src={resolvedTheme === "dark" ? "/aripa-mark-dark.svg" : "/aripa-mark-light.svg"}
                  alt=""
                  width="24"
                  height="24"
                  fetchPriority="high"
                  className="size-6 rounded-md"
                />
                <span className="text-sm font-semibold tracking-tight">Aripa</span>
              </Link>
              <div className="flex items-center gap-1 lg:hidden">
                <ThemeButton
                  themeMode={themeMode}
                  resolvedTheme={resolvedTheme}
                  onToggle={() => setThemeMode(nextThemeMode(themeMode))}
                />
                <SignOutButton onSignOut={() => void signOut()} />
              </div>
            </div>

            <nav
              aria-label="Dashboard"
              className="-mx-1 flex gap-0.5 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
            >
              {views.map((item) => {
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    prefetch={true}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={(event) => markNavigationPending(item.href, event)}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto hidden flex-col gap-3 lg:flex">
              {runtime ? (
                <div className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
                  <StatusDot tone={runtimeTone(runtime.state)} />
                  <span className="truncate">{runtime.label}</span>
                </div>
              ) : null}
              <div className="flex items-center gap-1 px-1.5">
                <ThemeButton
                  themeMode={themeMode}
                  resolvedTheme={resolvedTheme}
                  onToggle={() => setThemeMode(nextThemeMode(themeMode))}
                />
                <SignOutButton onSignOut={() => void signOut()} />
              </div>
            </div>
          </div>
        </aside>

        <main
          id="main-content"
          className="min-w-0 px-5 py-8 sm:px-8 lg:py-10"
          style={{ viewTransitionName: "dashboard-header" } as React.CSSProperties}
        >
          <div className="mx-auto w-full max-w-4xl">
            <h1 className="text-xl font-semibold tracking-tight">{viewTitle(view)}</h1>
            <div className="mt-6">
              {statusState.status === "error" ? (
                <ErrorPanel
                  title="Dashboard unavailable"
                  message={statusState.error}
                  onRetry={refreshStatus}
                />
              ) : (
                children({ statusState, refreshStatus, setStatusState })
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ThemeButton({
  themeMode,
  resolvedTheme,
  onToggle,
}: {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  onToggle: () => void;
}) {
  const label = themeButtonLabel(themeMode, resolvedTheme);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-foreground"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {resolvedTheme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}

function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-foreground"
      aria-label="Sign out"
      title="Sign out"
      onClick={onSignOut}
    >
      <LogOut aria-hidden="true" />
    </Button>
  );
}

function runtimeTone(state: DashboardStatus["botRuntime"]["state"]): "ok" | "danger" | "neutral" {
  switch (state) {
    case "running":
    case "docker":
      return "ok";
    case "stopped":
      return "danger";
  }
}

function viewTitle(view: View): string {
  return views.find((item) => item.id === view)?.label ?? "Overview";
}

function nextThemeMode(themeMode: ThemeMode): ThemeMode {
  switch (themeMode) {
    case "system":
      return "dark";
    case "dark":
      return "light";
    case "light":
      return "system";
  }
}

function themeButtonLabel(themeMode: ThemeMode, resolvedTheme: ResolvedTheme): string {
  switch (themeMode) {
    case "system":
      return `Using system appearance (${resolvedTheme}). Use dark appearance`;
    case "dark":
      return "Using dark appearance. Use light appearance";
    case "light":
      return "Using light appearance. Use system appearance";
  }
}
