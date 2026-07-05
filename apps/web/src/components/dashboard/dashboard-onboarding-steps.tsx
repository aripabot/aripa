"use client";

import type { ReactNode } from "react";
import { Clipboard, KeyRound, ShieldCheck } from "lucide-react";

import { Field } from "@/components/dashboard/dashboard-onboarding-controls";
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
import type { OnboardingOptionsResponse } from "@/lib/api-types";

type StyleOption = OnboardingOptionsResponse["styles"][number];

export function NameStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Bot Name" htmlFor="onboarding-name">
      <Input
        id="onboarding-name"
        name="name"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Aripa…"
        required
      />
    </Field>
  );
}

export function OperatorStep({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <Field label="Operator User ID" htmlFor="onboarding-operator">
      <Input
        id="onboarding-operator"
        name="operator-user-id"
        autoComplete="off"
        inputMode="numeric"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value.trim() || null)}
        placeholder="Optional Discord user ID…"
        spellCheck={false}
      />
    </Field>
  );
}

export function StyleStep({
  styles,
  value,
  onChange,
}: {
  styles: StyleOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Agent Style" htmlFor="onboarding-style">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="onboarding-style">
          <SelectValue placeholder="Choose a style" />
        </SelectTrigger>
        <SelectContent>
          {styles.map((style) => (
            <SelectItem key={style.value} value={style.value}>
              {style.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function ServerAllowlistStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Server Allowlist" htmlFor="onboarding-servers">
      <Textarea
        id="onboarding-servers"
        name="allowlisted-server-ids"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="123456789012345678…"
        spellCheck={false}
      />
    </Field>
  );
}

export function CustomRateLimitStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Messages Per Minute" htmlFor="onboarding-rate-limit-custom">
      <Input
        id="onboarding-rate-limit-custom"
        name="agent-rate-limit-custom"
        autoComplete="off"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="12…"
      />
    </Field>
  );
}

export function UpdateRepoStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="GitHub Repository" htmlFor="onboarding-update-repo">
      <Input
        id="onboarding-update-repo"
        name="update-repository"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="owner/repo…"
        spellCheck={false}
      />
    </Field>
  );
}

export function UpdateKeyPasteStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Base64 Public Key" htmlFor="onboarding-release-key">
      <Textarea
        id="onboarding-release-key"
        name="release-public-key"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder="Optional base64 public key…"
        spellCheck={false}
      />
    </Field>
  );
}

export function UpdateKeyChoiceStep({
  onGenerate,
  onPaste,
  onUseEnvironmentVariable,
}: {
  onGenerate: () => void;
  onPaste: () => void;
  onUseEnvironmentVariable: () => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Button type="button" variant="outline" onClick={onGenerate}>
        <KeyRound aria-hidden="true" />
        Generate Keypair
      </Button>
      <Button type="button" variant="outline" onClick={onPaste}>
        Paste Public Key
      </Button>
      <Button type="button" variant="outline" onClick={onUseEnvironmentVariable}>
        Use Environment Variable
      </Button>
    </div>
  );
}

export function GeneratedUpdateKeyStep({
  privateKey,
  onCopy,
  onRegenerate,
}: {
  privateKey: string | null;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border bg-muted p-3">
        <p className="text-sm font-medium">ARIPA_RELEASE_PRIVATE_KEY_PEM_B64</p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{privateKey}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onCopy}>
          <Clipboard aria-hidden="true" />
          Copy Secret Value
        </Button>
        <Button type="button" variant="outline" onClick={onRegenerate}>
          Regenerate Keypair
        </Button>
      </div>
    </div>
  );
}

export function ReviewStep({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border bg-muted p-3">
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {children}
        </pre>
      </div>
      <div className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
        <ShieldCheck aria-hidden="true" />
        <p className="text-muted-foreground">
          Saving writes config.json and applies the automatic update schedule.
        </p>
      </div>
    </div>
  );
}
