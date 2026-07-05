"use client";

import type { RuntimeModelSelection } from "@aripabot/core/config/config.ts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/dashboard/components/fields";
import type { DashboardStatus } from "@/lib/api-types";

export function ModelCard({
  title,
  model,
  providers,
  reasoningEfforts,
  onChange,
}: {
  title: string;
  model: RuntimeModelSelection;
  providers: DashboardStatus["providers"];
  reasoningEfforts: DashboardStatus["reasoningEfforts"];
  onChange: (patch: Partial<RuntimeModelSelection>) => void;
}) {
  const idBase = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Provider, model, and reasoning settings.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Provider" htmlFor={`${idBase}-provider`}>
          <Select
            value={model.provider}
            onValueChange={(provider) =>
              onChange({ provider: provider as RuntimeModelSelection["provider"] })
            }
          >
            <SelectTrigger id={`${idBase}-provider`}>
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
        <Field label="Model" htmlFor={`${idBase}-model`}>
          <Input
            id={`${idBase}-model`}
            name={`${idBase}-model`}
            autoComplete="off"
            value={model.model}
            onChange={(event) => onChange({ model: event.target.value })}
            spellCheck={false}
          />
        </Field>
        <Field label="Reasoning" htmlFor={`${idBase}-reasoning`}>
          <Select
            value={model.reasoningEffort ?? "low"}
            onValueChange={(reasoningEffort) =>
              onChange({
                reasoningEffort: reasoningEffort as RuntimeModelSelection["reasoningEffort"],
              })
            }
          >
            <SelectTrigger id={`${idBase}-reasoning`}>
              <SelectValue placeholder="Choose effort" />
            </SelectTrigger>
            <SelectContent>
              {reasoningEfforts.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}
