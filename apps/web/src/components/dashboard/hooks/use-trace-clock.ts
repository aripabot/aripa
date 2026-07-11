"use client";

import { useEffect, useState } from "react";

export function useTraceClock(active: boolean, wakeAt: number | null = null): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    if (active) {
      const interval = setInterval(() => setNow(Date.now()), 1_000);
      return () => clearInterval(interval);
    }
    if (wakeAt === null) return;

    const delay = wakeAt - Date.now();
    if (delay <= 0) return;
    const timeout = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [active, wakeAt]);

  return now;
}
