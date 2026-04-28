"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function NavProgress() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Reset on pathname change (navigation completed)
  useEffect(() => {
    if (loading) {
      setProgress(100);
      const t = setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 200);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Listen for link clicks to start the progress bar immediately
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || target.target === "_blank") return;
      if (target.pathname === pathname) return;
      setLoading(true);
      setProgress(30);
      setTimeout(() => setProgress(70), 150);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  if (!loading) return null;

  return (
    <div className="fixed top-0 left-0 right-0 h-0.5 z-[10000] bg-white/5">
      <div
        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-all duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
