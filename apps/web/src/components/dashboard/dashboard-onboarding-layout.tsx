"use client";

import type * as React from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  void showPrimarySaveIcon;

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen w-full max-w-[88rem] lg:grid-cols-[13.5rem_1fr]">
        <aside className="border-b lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-6 px-4 py-4 lg:sticky lg:top-0 lg:max-h-screen lg:py-6">
            <div className="flex items-center gap-2.5">
              <picture>
                <img
                  src="/aripa-mark-light.svg"
                  alt=""
                  width="24"
                  height="24"
                  fetchPriority="high"
                  className="size-6 rounded-md dark:hidden"
                />
                <img
                  src="/aripa-mark-dark.svg"
                  alt=""
                  width="24"
                  height="24"
                  fetchPriority="high"
                  className="hidden size-6 rounded-md dark:block"
                />
              </picture>
              <span className="text-sm font-semibold tracking-tight">Aripa</span>
            </div>

            <OnboardingProgress activeProgressIndex={activeProgressIndex} />

            <div className="mt-auto hidden px-1.5 lg:block">
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
            </div>
          </div>
        </aside>

        <section className="min-w-0 px-5 py-8 sm:px-8 lg:py-10">
          <div className="mx-auto grid w-full max-w-lg gap-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>

            {loadingOptions ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Loading…
              </p>
            ) : (
              stepContent
            )}

            {error ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {message}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-2 border-t pt-5">
              {canGoBack ? (
                <Button type="button" variant="ghost" onClick={onBack}>
                  Back
                </Button>
              ) : (
                <span />
              )}
              <Button type="button" onClick={onContinue} disabled={primaryDisabled}>
                {primaryLabel}
              </Button>
            </div>

            <p className="break-all font-mono text-xs text-muted-foreground">{configPath}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
