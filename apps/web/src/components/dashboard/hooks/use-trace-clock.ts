"use client";

import { useEffect, useState } from "react";

export function useTraceClock(active: boolean): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [active]);

  return now;
}
