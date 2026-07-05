"use client";

import type * as React from "react";
import { CheckCircle2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { stepIndex } from "@aripabot/core/onboarding-wizard/navigation.ts";
import type { Step as WizardStep } from "@aripabot/core/onboarding-wizard/types.ts";
import type { ConfigurableRuntimeModelProvider } from "@aripabot/core/config/config.ts";

type Step = Exclude<WizardStep, "existing-config" | "done">;

const progressSteps: Array<{ step: Step; label: string }> = [
  { step: "name", label: "Name" },
  { step: "operator", label: "Operator" },
  { step: "style", label: "Style" },
  { step: "servers", label: "Servers" },
  { step: "rate-limit", label: "Rate Limit" },
  { step: "log-privacy", label: "Log Privacy" },
  { step: "models", label: "Models" },
  { step: "update-source", label: "Updates" },
  { step: "review", label: "Review" },
];

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function ProviderSelect({
  id,
  label,
  providers,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  providers: ConfigurableRuntimeModelProvider[];
  value: ConfigurableRuntimeModelProvider;
  onValueChange: (value: ConfigurableRuntimeModelProvider) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select
        value={value}
        onValueChange={(provider) => onValueChange(provider as ConfigurableRuntimeModelProvider)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose provider" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => (
            <SelectItem key={provider} value={provider}>
              {provider}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function OnboardingProgress({ activeProgressIndex }: { activeProgressIndex: number }) {
  return (
    <nav aria-label="Onboarding progress" className="flex flex-col gap-1">
      {progressSteps.map((item, index) => {
        const itemProgressIndex = stepIndex(item.step);
        const active = itemProgressIndex === activeProgressIndex;
        const completed = itemProgressIndex < activeProgressIndex;
        return (
          <div
            key={item.step}
            aria-current={active ? "step" : undefined}
            className="flex h-10 items-center gap-3 rounded-md px-3 text-sm"
            data-active={active ? "" : undefined}
          >
            <span className="flex size-6 items-center justify-center rounded-md border bg-background text-xs text-muted-foreground">
              {completed ? <CheckCircle2 aria-hidden="true" /> : index + 1}
            </span>
            <span className="min-w-0 truncate font-medium">{item.label}</span>
          </div>
        );
      })}
    </nav>
  );
}

export function ModelSelect({
  id,
  label,
  options,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  options: Array<{ name: string; description: string; value: string }>;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose model" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex flex-col gap-1">
                <span>{option.name}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
