"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type * as React from "react";
import { Activity, Container, Download, LogOut, Logs, Moon, Settings, Sun } from "lucide-react";

import { ErrorPanel } from "@/components/dashboard/components/panels";
import { DashboardOnboardingScreen } from "@/components/dashboard/dashboard-onboarding-screen";
import { useLoadState } from "@/components/dashboard/hooks/use-load-state";
import { Button } from "@/components/ui/button";
import { getStatus } from "@/lib/api";
import type { CompleteOnboardingResponse, DashboardStatus } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import type { LoadState } from "@/server/dashboard-page-data";

export type View = "overview" | "logs" | "updates" | "docker-deployments" | "settings";
type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface DashboardShellRenderContext {
  statusState: LoadState<DashboardStatus>;
  refreshStatus: () => Promise<void>;
  setStatusState: React.Dispatch<React.SetStateAction<LoadState<DashboardStatus>>>;
}

const views: Array<{ id: View; label: string; href: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", href: "/", icon: Activity },
  { id: "logs", label: "Logs", href: "/logs", icon: Logs },
  { id: "updates", label: "Updates", href: "/updates", icon: Download },
  {
    id: "docker-deployments",
    label: "Docker Deployments",
    href: "/docker-deployments",
    icon: Container,
  },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings },
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

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[16rem_1fr]">
        <aside
          className="border-b bg-card/70 lg:border-b-0 lg:border-r"
          style={{ viewTransitionName: "dashboard-sidebar" } as React.CSSProperties}
        >
          <div className="flex h-full flex-col gap-5 p-4">
            <div className="flex items-center gap-3">
              <picture>
                <img
                  src={resolvedTheme === "dark" ? "/aripa-mark-dark.svg" : "/aripa-mark-light.svg"}
                  alt=""
                  width="40"
                  height="40"
                  fetchPriority="high"
                  className="size-10 rounded-lg"
                />
              </picture>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Aripa</p>
                <p className="text-xs text-muted-foreground">Local dashboard (Experimental)</p>
              </div>
            </div>

            <nav
              aria-label="Dashboard"
              className="grid grid-cols-2 gap-1 sm:grid-cols-5 lg:flex lg:flex-col"
            >
              {views.map((item) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    prefetch={true}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-10 items-center justify-start gap-2 rounded-md px-4 py-2 text-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active ? "bg-foreground text-background" : "text-foreground",
                    )}
                    onClick={(event) => markNavigationPending(item.href, event)}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto hidden rounded-lg border bg-background p-3 text-sm lg:block">
              <p className="font-medium">Runtime</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {statusState.status === "ready"
                  ? statusState.data.configPath
                  : "Loading config path…"}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" />
              Sign Out
            </Button>
          </div>
        </aside>

        <div className="min-w-0">
          <header
            className="sticky top-0 z-20 border-b bg-background/92 backdrop-blur"
            style={{ viewTransitionName: "dashboard-header" } as React.CSSProperties}
          >
            <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="min-w-0">
                <h1 className="truncate text-pretty text-xl font-semibold tracking-normal sm:text-2xl">
                  {viewTitle(view)}
                </h1>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={themeButtonLabel(themeMode, resolvedTheme)}
                title={themeButtonLabel(themeMode, resolvedTheme)}
                onClick={() => setThemeMode(nextThemeMode(themeMode))}
              >
                {resolvedTheme === "dark" ? (
                  <Sun aria-hidden="true" />
                ) : (
                  <Moon aria-hidden="true" />
                )}
              </Button>
            </div>
          </header>

          <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
            {statusState.status === "error" ? (
              <ErrorPanel
                title="Dashboard unavailable"
                message={statusState.error}
                onRetry={refreshStatus}
              />
            ) : (
              children({ statusState, refreshStatus, setStatusState })
            )}
          </main>
        </div>
      </div>
    </div>
  );
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
