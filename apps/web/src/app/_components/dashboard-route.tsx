import { ViewTransition } from "react";
import type * as React from "react";

export function DashboardRoute({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="fade-in" exit="none" default="none">
      {children}
    </ViewTransition>
  );
}
