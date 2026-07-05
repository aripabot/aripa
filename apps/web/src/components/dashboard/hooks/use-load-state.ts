"use client";

import { useCallback, useState } from "react";
import type * as React from "react";

import { readableError } from "@/lib/errors";
import type { LoadState } from "@/server/dashboard-page-data";

export function initialLoadState<T>(): LoadState<T> {
  return { status: "loading", data: null, error: null };
}

export function useLoadState<T>(
  loader: () => Promise<T>,
  initialState: LoadState<T> | undefined,
): {
  state: LoadState<T>;
  refresh: () => Promise<void>;
  setState: React.Dispatch<React.SetStateAction<LoadState<T>>>;
} {
  const [state, setState] = useState<LoadState<T>>(() => initialState ?? initialLoadState());

  const refresh = useCallback(async () => {
    setState(initialLoadState<T>());

    try {
      setState({ status: "ready", data: await loader(), error: null });
    } catch (error) {
      setState({ status: "error", data: null, error: readableError(error) });
    }
  }, [loader]);

  return { state, refresh, setState };
}
