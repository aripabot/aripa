"use client";

import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, SwitchField } from "@/components/dashboard/components/fields";
import { ModelCard } from "@/components/dashboard/components/model-card";
import { formatTime } from "@/components/dashboard/lib/format";
import { saveConfig } from "@/lib/api";
import type { DashboardStatus, SaveConfigResponse } from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import type { RuntimeJsonConfig, RuntimeModelSelection } from "@aripabot/core/config/config.ts";

export function SettingsPage({
  status,
  onSaved,
}: {
  status: DashboardStatus;
  onSaved: (result: SaveConfigResponse) => void;
}) {
  const [config, setConfig] = useState<RuntimeJsonConfig>(status.config);
  const [allowlistInput, setAllowlistInput] = useState(
    status.config.allowlistedServerIds.join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = useMemo(
    () =>
      JSON.stringify(config) !== JSON.stringify(status.config) ||
      allowlistInput !== status.config.allowlistedServerIds.join("\n"),
    [allowlistInput, config, status.config],
  );

  const hasWebModel = config.models.web.enabled;

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const nextConfig = {
        ...config,
        allowlistedServerIds: allowlistInput
          .split(/[\s,]+/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
      const result = await saveConfig({ config: nextConfig });
      setConfig(result.config);
      setAllowlistInput(result.config.allowlistedServerIds.join("\n"));
      setMessage(`Saved ${formatTime(result.savedAt)}.`);
      onSaved(result);
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setSaving(false);
    }
  }

  function updateModel(role: "agent" | "summarizer", patch: Partial<RuntimeModelSelection>) {
    setConfig((current) => ({
      ...current,
      models: {
        ...current.models,
        [role]: {
          ...current.models[role],
          ...patch,
        },
      },
    }));
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="break-words text-sm text-muted-foreground">
          Changes are written to {status.configPath}.
        </p>
        <Button type="submit" disabled={saving}>
          <Save aria-hidden="true" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
      {message ? (
        <p className="rounded-md border bg-card px-3 py-2 text-sm" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>How Aripa presents itself.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Bot name" htmlFor="name">
              <Input
                id="name"
                name="name"
                autoComplete="off"
                value={config.name}
                onChange={(event) => setConfig({ ...config, name: event.target.value })}
                required
              />
            </Field>
            <Field label="Operator user ID" htmlFor="operator">
              <Input
                id="operator"
                name="operator-user-id"
                autoComplete="off"
                inputMode="numeric"
                value={config.operatorUserId ?? ""}
                onChange={(event) =>
                  setConfig({ ...config, operatorUserId: event.target.value.trim() || null })
                }
                placeholder="Optional Discord user ID…"
                spellCheck={false}
              />
            </Field>
            <Field label="Style" htmlFor="style">
              <Select
                value={config.stylePrompt}
                onValueChange={(value) => setConfig({ ...config, stylePrompt: value })}
              >
                <SelectTrigger id="style">
                  <SelectValue placeholder="Choose a style" />
                </SelectTrigger>
                <SelectContent>
                  {status.styles.map((style) => (
                    <SelectItem key={style.value} value={style.value}>
                      {style.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access Controls</CardTitle>
            <CardDescription>Servers allowed to use Aripa.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Server allowlist" htmlFor="allowlist">
              <Textarea
                id="allowlist"
                name="allowlisted-server-ids"
                autoComplete="off"
                value={allowlistInput}
                onChange={(event) => setAllowlistInput(event.target.value)}
                placeholder="One Discord server ID per line…"
                spellCheck={false}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent Controls</CardTitle>
            <CardDescription>Limits and privacy defaults for agent replies.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Rate limit" htmlFor="rate-limit">
              <Input
                id="rate-limit"
                name="agent-rate-limit"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentRateLimitMessagesPerMinute ?? ""}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    agentRateLimitMessagesPerMinute:
                      event.target.value.trim() === "" ? null : Number(event.target.value),
                  })
                }
                placeholder="Off…"
              />
            </Field>
            <Field label="Timeout" htmlFor="timeout">
              <Input
                id="timeout"
                name="agent-timeout"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentTimeoutMs}
                onChange={(event) =>
                  setConfig({ ...config, agentTimeoutMs: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Global concurrency" htmlFor="global-concurrency">
              <Input
                id="global-concurrency"
                name="agent-global-concurrency"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentMaxConcurrentRequests}
                onChange={(event) =>
                  setConfig({ ...config, agentMaxConcurrentRequests: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Per-server concurrency" htmlFor="guild-concurrency">
              <Input
                id="guild-concurrency"
                name="agent-guild-concurrency"
                autoComplete="off"
                inputMode="numeric"
                value={config.agentMaxConcurrentRequestsPerGuild}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    agentMaxConcurrentRequestsPerGuild: Number(event.target.value),
                  })
                }
              />
            </Field>
            <SwitchField
              label="Private logs"
              checked={config.logPrivacy}
              onCheckedChange={(checked) => setConfig({ ...config, logPrivacy: checked })}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ModelCard
          title="Agent Model"
          model={config.models.agent}
          providers={status.providers.filter((provider) => provider !== "google")}
          reasoningEfforts={status.reasoningEfforts}
          onChange={(patch) => updateModel("agent", patch)}
        />
        <ModelCard
          title="Summarizer Model"
          model={config.models.summarizer}
          providers={status.providers.filter((provider) => provider !== "google")}
          reasoningEfforts={status.reasoningEfforts}
          onChange={(patch) => updateModel("summarizer", patch)}
        />
        <Card>
          <CardHeader>
            <CardTitle>Web Search</CardTitle>
            <CardDescription>Optional search model for recent context.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SwitchField
              label="Enable web search"
              checked={hasWebModel}
              onCheckedChange={(enabled) =>
                setConfig({
                  ...config,
                  models: { ...config.models, web: { ...config.models.web, enabled } },
                })
              }
            />
            <Field label="Model" htmlFor="web-model">
              <Input
                id="web-model"
                name="web-model"
                autoComplete="off"
                value={config.models.web.model}
                disabled={!hasWebModel}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    models: {
                      ...config.models,
                      web: { ...config.models.web, model: event.target.value },
                    },
                  })
                }
              />
            </Field>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
