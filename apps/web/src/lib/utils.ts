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
