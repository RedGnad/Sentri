"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/connect-button";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

const NAV_ITEMS = [
  { href: "/vaults", label: "Vaults", num: "01" },
  { href: "/deploy", label: "Deploy", num: "02" },
  { href: "/my", label: "My Vaults", num: "03" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string): boolean {
    if (href === "/vaults") return pathname === "/vaults" || pathname.startsWith("/v/");
    return pathname === href;
  }

  return (
    <nav className="border-b border-hairline bg-bg/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-10">
            <Link href="/" className="flex items-baseline gap-2 group">
              <span className="font-serif text-2xl text-ink leading-none tracking-tightest">
                Sentri
              </span>
              <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
                [v1.0]
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-0 border-l border-hairline pl-8">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    className={cn(
                      "group flex items-baseline gap-1.5 px-4 py-2 font-mono text-[11px] uppercase tracking-kicker transition-colors relative",
                      active ? "text-amber" : "text-ink-dim hover:text-ink",
                    )}
                  >
                    <span className="text-ink-faint">{item.num}</span>
                    <span>{item.label}</span>
                    {active && <span className="absolute bottom-0 left-4 right-4 h-px bg-amber" />}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConnectButton />
            <button
              className="md:hidden p-2 border border-hairline hover:border-amber transition-colors"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-hairline py-2">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-baseline gap-2 px-2 py-3 font-mono text-xs uppercase tracking-kicker border-b border-hairline last:border-b-0",
                    active ? "text-amber" : "text-ink-dim",
                  )}
                >
                  <span className="text-ink-faint">{item.num}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
