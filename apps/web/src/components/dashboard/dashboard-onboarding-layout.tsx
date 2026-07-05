"use client";

import type * as React from "react";
import { LogOut, Save, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingProgress } from "@/components/dashboard/dashboard-onboarding-controls";

export function DashboardOnboardingLayout({
  activeProgressIndex,
  configPath,
  description,
  error,
  loadingOptions,
  message,
  onBack,
  onContinue,
  onSignOut,
  primaryDisabled,
  primaryLabel,
  showPrimarySaveIcon,
  stepContent,
  title,
  canGoBack,
}: {
  activeProgressIndex: number;
  configPath: string;
  description: string;
  error: string | null;
  loadingOptions: boolean;
  message: string | null;
  onBack: () => void;
  onContinue: () => void;
  onSignOut: () => void;
  primaryDisabled: boolean;
  primaryLabel: string;
  showPrimarySaveIcon: boolean;
  stepContent: React.ReactNode;
  title: string;
  canGoBack: boolean;
}) {
  return (
    <main id="main-content" className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[17rem_1fr]">
        <aside className="border-b bg-card/70 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-5 p-4">
            <div className="flex items-center gap-3">
              <picture>
                <img
                  src="/aripa-mark-light.svg"
                  alt=""
                  width="40"
                  height="40"
                  fetchPriority="high"
                  className="size-10 rounded-lg dark:hidden"
                />
                <img
                  src="/aripa-mark-dark.svg"
                  alt=""
                  width="40"
                  height="40"
                  fetchPriority="high"
                  className="hidden size-10 rounded-lg dark:block"
                />
              </picture>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Aripa</p>
                <p className="text-xs text-muted-foreground">First-Run Setup</p>
              </div>
            </div>

            <OnboardingProgress activeProgressIndex={activeProgressIndex} />

            <div className="mt-auto">
              <Button type="button" variant="outline" className="w-full" onClick={onSignOut}>
                <LogOut aria-hidden="true" />
                Sign Out
              </Button>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">No config.json was found.</p>
              <h1 className="text-2xl font-semibold tracking-normal text-pretty">
                Configure Aripa
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty"></p>
            </div>
            <div className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
              <span className="break-all">{configPath}</span>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
                <Sparkles aria-hidden="true" />
              </div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {loadingOptions ? (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Loading setup options…
                </p>
              ) : (
                stepContent
              )}

              {error ? (
                <p className="rounded-md border bg-muted px-3 py-2 text-sm" aria-live="polite">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="rounded-md border bg-muted px-3 py-2 text-sm" aria-live="polite">
                  {message}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="outline" onClick={onBack} disabled={!canGoBack}>
                  Back
                </Button>
                <Button type="button" onClick={onContinue} disabled={primaryDisabled}>
                  {showPrimarySaveIcon ? <Save aria-hidden="true" /> : null}
                  {primaryLabel}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
