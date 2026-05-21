"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/utils";

/**
 * Self-ticking "Xs ago" label. The underlying timestamp only changes when the
 * data is re-polled, but this re-renders itself once per second so the elapsed
 * time counts up smoothly between polls instead of jumping every 15s. Only this
 * node re-renders — not its parent.
 */
export function RelativeTime({
  timestampMs,
}: {
  timestampMs: number | null | undefined;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!timestampMs) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000);
    return () => window.clearInterval(id);
  }, [timestampMs]);

  return <>{formatRelative(timestampMs)}</>;
}
