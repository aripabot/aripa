import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {label}…
      </p>
    </div>
  );
}

export function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-10 text-center">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-md break-words text-sm text-muted-foreground">{message}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

export function EmptyPanel({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-6 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {message ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
