import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUSDC(value: bigint): string {
  const num = Number(value) / 1e6;
  if (num === 0) return "0.00";
  if (num > 0 && num < 0.01) {
    // Sub-cent values: show 4 decimals so they don't render as "$0.00"
    return num.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  if (num < 1) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(1);
}

/** Compact "time ago" label for a millisecond timestamp (e.g. "40s ago"). */
export function formatRelative(timestampMs: number | null | undefined): string {
  if (!timestampMs) return "—";
  const ageSec = Math.floor((Date.now() - timestampMs) / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}
