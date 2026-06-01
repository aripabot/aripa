"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type * as React from "react";
import { KeyRound, LockKeyhole, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DashboardAuthState } from "@/server/dashboard-auth";

export function DashboardAuthScreen({ authState }: { authState: DashboardAuthState }) {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
    >
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center">
          <picture>
            <img
              src="/aripa-mark-light.svg"
              alt=""
              width="48"
              height="48"
              fetchPriority="high"
              className="size-12 rounded-lg dark:hidden"
            />
            <img
              src="/aripa-mark-dark.svg"
              alt=""
              width="48"
              height="48"
              fetchPriority="high"
              className="hidden size-12 rounded-lg dark:block"
            />
          </picture>
        </div>

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
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
          <ShieldAlert aria-hidden="true" />
        </div>
        <CardTitle>Dashboard Locked</CardTitle>
        <CardDescription>
          Create the dashboard password before opening Aripa from a browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-md border bg-muted p-3 font-mono text-sm">
          bun run dashboard:password
        </div>
        <p className="break-words text-sm text-muted-foreground">
          Keep the generated password somewhere safe. It is only shown once.
        </p>
        <p className="break-words text-xs text-muted-foreground">{authPath}</p>
      </CardContent>
    </Card>
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
        throw new Error(payload.error ?? "Sign in failed.");
      }

      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
          <LockKeyhole aria-hidden="true" />
        </div>
        <CardTitle>Enter Dashboard Password</CardTitle>
        <CardDescription>Use the password generated for this Aripa installation.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dashboard-password">Password</Label>
            <Input
              id="dashboard-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
              autoFocus
              required
            />
          </div>

          {error ? (
            <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">{error}</p>
          ) : null}

          <Button type="submit" disabled={isSubmitting}>
            <KeyRound aria-hidden="true" />
            {isSubmitting ? "Unlocking" : "Unlock"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
