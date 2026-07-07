"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DashboardAuthState } from "@/server/dashboard-auth";

export function DashboardAuthScreen({ authState }: { authState: DashboardAuthState }) {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
    >
      <div className="w-full max-w-xs">
        <picture>
          <img
            src="/aripa-mark-light.svg"
            alt=""
            width="32"
            height="32"
            fetchPriority="high"
            className="size-8 rounded-md dark:hidden"
          />
          <img
            src="/aripa-mark-dark.svg"
            alt=""
            width="32"
            height="32"
            fetchPriority="high"
            className="hidden size-8 rounded-md dark:block"
          />
        </picture>

        {authState.status === "not_configured" ? (
          <DashboardPasswordSetup authPath={authState.authPath} />
        ) : (
          <DashboardLogin />
        )}
      </div>
    </main>
  );
}

function DashboardPasswordSetup({ authPath }: { authPath: string }) {
  return (
    <div className="mt-6">
      <h1 className="text-lg font-semibold tracking-tight">Create a password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The dashboard needs a password before it can open. Run this once, then keep the password it
        prints — it isn't shown again.
      </p>
      <p className="mt-4 rounded-lg border bg-muted/40 px-3.5 py-2.5 font-mono text-sm">
        bun run dashboard:password
      </p>
      <p className="mt-4 break-all font-mono text-xs text-muted-foreground">{authPath}</p>
    </div>
  );
}

function DashboardLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "That password didn't work. Try again.");
      }

      router.refresh();
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : "That password didn't work. Try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
      <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dashboard-password">Password</Label>
        <Input
          id="dashboard-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "password-error" : undefined}
          autoFocus
          required
        />
        {error ? (
          <p id="password-error" className="text-sm text-muted-foreground" aria-live="polite">
            {error}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
