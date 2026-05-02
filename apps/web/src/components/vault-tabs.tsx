"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { suffix: "", label: "Overview" },
  { suffix: "/audit", label: "Audit" },
  { suffix: "/policy", label: "Policy" },
  { suffix: "/emergency", label: "Emergency" },
];

/**
 * Tab nav for the /v/[address]/* hub. Active tab inferred from pathname.
 */
export function VaultTabs({ address }: { address: string }) {
  const pathname = usePathname();
  const base = `/v/${address}`;

  return (
    <nav className="border-b border-hairline">
      <ul className="flex">
        {TABS.map((tab) => {
          const href = `${base}${tab.suffix}`;
          const active =
            tab.suffix === ""
              ? pathname === href || pathname === `${base}`
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={tab.label}>
              <Link
                href={href}
                className={cn(
                  "block px-5 py-3 font-mono text-[10px] uppercase tracking-kicker transition-colors relative",
                  active ? "text-amber" : "text-ink-dim hover:text-ink",
                )}
              >
                {tab.label}
                {active && <span className="absolute bottom-0 left-5 right-5 h-px bg-amber" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
