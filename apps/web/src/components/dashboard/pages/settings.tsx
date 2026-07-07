"use client";

import { useEffect, useMemo, useState } from "react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, SettingsSection, SwitchField } from "@/components/dashboard/components/fields";
import { ModelFields } from "@/components/dashboard/components/model-card";
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
      setMessage(`Saved at ${formatTime(result.savedAt)}`);
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
    <form className="grid max-w-2xl gap-8" onSubmit={submit}>
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
          {message ?? (dirty ? "Unsaved changes" : "")}
        </p>
        <Button type="submit" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <SettingsSection title="Identity">
        <Field label="Name" htmlFor="name">
          <Input
            id="name"
            name="name"
            autoComplete="off"
            value={config.name}
            onChange={(event) => setConfig({ ...config, name: event.target.value })}
            required
          />
        </Field>
        <Field
          label="Operator user ID"
          htmlFor="operator"
          hint="This Discord user can run operator commands."
        >
          <Input
            id="operator"
            name="operator-user-id"
            autoComplete="off"
            inputMode="numeric"
            className="max-w-xs"
            value={config.operatorUserId ?? ""}
            onChange={(event) =>
              setConfig({ ...config, operatorUserId: event.target.value.trim() || null })
            }
            spellCheck={false}
          />
        </Field>
        <Field label="Style" htmlFor="style">
          <Select
            value={config.stylePrompt}
            onValueChange={(value) => setConfig({ ...config, stylePrompt: value })}
          >
            <SelectTrigger id="style" className="max-w-xs">
              <SelectValue placeholder="Style" />
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
      </SettingsSection>

      <SettingsSection title="Access">
        <Field
          label="Server allowlist"
          htmlFor="allowlist"
          hint="One server ID per line. Only these servers can use the bot."
        >
          <Textarea
            id="allowlist"
            name="allowlisted-server-ids"
            autoComplete="off"
            className="font-mono"
            value={allowlistInput}
            onChange={(event) => setAllowlistInput(event.target.value)}
            spellCheck={false}
          />
        </Field>
      </SettingsSection>

      <SettingsSection title="Limits">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Rate limit"
            htmlFor="rate-limit"
            hint="Messages per minute. Empty for no limit."
          >
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
            />
          </Field>
          <Field label="Timeout" htmlFor="timeout" hint="Milliseconds before a reply is abandoned.">
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
          <Field label="Concurrent replies" htmlFor="global-concurrency">
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
          <Field label="Concurrent replies per server" htmlFor="guild-concurrency">
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
        </div>
        <SwitchField
          label="Private logs"
          hint="Keep message content out of the runtime logs."
          checked={config.logPrivacy}
          onCheckedChange={(checked) => setConfig({ ...config, logPrivacy: checked })}
        />
      </SettingsSection>

      <SettingsSection title="Models">
        <div className="grid gap-8 sm:grid-cols-2">
          <ModelFields
            title="Replies"
            model={config.models.agent}
            providers={status.providers.filter((provider) => provider !== "google")}
            reasoningEfforts={status.reasoningEfforts}
            onChange={(patch) => updateModel("agent", patch)}
          />
          <ModelFields
            title="Summaries"
            model={config.models.summarizer}
            providers={status.providers.filter((provider) => provider !== "google")}
            reasoningEfforts={status.reasoningEfforts}
            onChange={(patch) => updateModel("summarizer", patch)}
          />
        </div>
        <div className="grid gap-4 border-t pt-5">
          <SwitchField
            label="Web search"
            hint="Let replies pull in recent information."
            checked={hasWebModel}
            onCheckedChange={(enabled) =>
              setConfig({
                ...config,
                models: { ...config.models, web: { ...config.models.web, enabled } },
              })
            }
          />
          {hasWebModel ? (
            <Field label="Search model" htmlFor="web-model">
              <Input
                id="web-model"
                name="web-model"
                autoComplete="off"
                className="max-w-xs"
                value={config.models.web.model}
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
          ) : null}
        </div>
      </SettingsSection>

      <p className="break-all border-t pt-5 font-mono text-xs text-muted-foreground">
        {status.configPath}
      </p>
    </form>
  );
}
