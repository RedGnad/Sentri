"use client";

import { useEffect, useState } from "react";
import type { LiveSnapshot } from "@/lib/live-state";

function networkLabel(chainId: number): string {
  return chainId === 16661 ? "0G Mainnet" : "0G Galileo";
}

function formatCompactNumber(num: number): string {
  if (num < 1000) return num.toString();
  if (num < 1000000)
    return `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k`;
  if (num < 1000000000)
    return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}M`;
  return `${(num / 1000000000).toFixed(num % 1000000000 === 0 ? 0 : 1)}B`;
}

function formatRelative(timestampMs: number | null): string {
  if (!timestampMs) return "—";
  const ageSec = Math.floor((Date.now() - timestampMs) / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

function dotClass(state: "ok" | "warn" | "off"): string {
  if (state === "ok") return "bg-phosphor animate-pulse-dot";
  if (state === "warn") return "bg-amber";
  return "bg-ink-faint";
}

function chainState(snapshot: LiveSnapshot): "ok" | "warn" | "off" {
  if (!snapshot.chain.rpcOk) return "off";
  if ((snapshot.chain.blockAgeSec ?? 999) > 30) return "warn";
  return "ok";
}

function agentState(snapshot: LiveSnapshot): "ok" | "warn" | "off" {
  if (!snapshot.agent.ok) return "off";
  if (!snapshot.agent.lastCycleAt) return "warn";
  const snapshotAge = snapshot.fetchedAt ? Date.now() - snapshot.fetchedAt : 0;
  const ageMs =
    Date.now() - snapshot.agent.lastCycleAt - Math.max(0, snapshotAge);
  const intervalMs = (snapshot.agent.intervalSec ?? 300) * 1000;
  if (ageMs > intervalMs * 5) return "warn";
  return "ok";
}

function ProtocolRow({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "ok" | "warn" | "off";
}) {
  return (
    <li className="flex items-center justify-between px-4 h-11 gap-3">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint shrink-0">
        {label}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink flex items-center gap-2 truncate">
        <span className="truncate">{value}</span>
        <span
          className={`inline-block w-1 h-1 rounded-full shrink-0 ${dotClass(state)}`}
        />
      </span>
    </li>
  );
}

export function LiveSystemPanel({
  initialSnapshot,
}: {
  initialSnapshot: LiveSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      try {
        const res = await fetch("/api/live-snapshot", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as LiveSnapshot;
        if (mounted) setSnapshot(next);
      } catch {}
    }

    const id = window.setInterval(refresh, 15_000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const c = chainState(snapshot);
  const a = agentState(snapshot);
  const chainLabel = networkLabel(snapshot.chain.id);

  const rows = [
    {
      key: "Chain",
      value: snapshot.chain.rpcOk
        ? `${chainLabel} · #${snapshot.chain.blockNumber} · ${snapshot.chain.blockAgeSec}s`
        : "RPC unreachable",
      state: c,
    },
    {
      key: "Vaults",
      value:
        snapshot.protocol.vaultsCount !== null
          ? `${snapshot.protocol.vaultsCount} live`
          : "protocol read failed",
      state: snapshot.protocol.vaultsCount !== null ? "ok" : ("warn" as const),
    },
    {
      key: "Total TVL",
      value:
        snapshot.protocol.totalTVL !== null
          ? `$${snapshot.protocol.totalTVL}`
          : "on-chain read pending",
      state: snapshot.protocol.totalTVL !== null ? "ok" : ("warn" as const),
    },
    {
      key: "Executions",
      value:
        snapshot.protocol.totalExecutions !== null
          ? `${snapshot.protocol.totalExecutions.toLocaleString()} total`
          : "on-chain read pending",
      state:
        snapshot.protocol.totalExecutions !== null ? "ok" : ("warn" as const),
    },
    {
      key: "Agent",
      value:
        snapshot.agent.status === "ready"
          ? `${formatCompactNumber(snapshot.agent.cycles ?? 0)} cycles · ${formatRelative(snapshot.agent.lastCycleAt)}`
          : snapshot.agent.status === "initializing"
            ? "Initializing"
            : snapshot.agent.status === "error"
              ? "Setup error"
              : "Unreachable",
      state: a,
    },
    {
      key: "Model",
      value: snapshot.agent.model
        ? snapshot.agent.model.slice(0, 22) +
          (snapshot.agent.model.length > 22 ? "…" : "")
        : "—",
      state: (snapshot.agent.model ? "ok" : "off") as "ok" | "off",
    },
  ] as const;

  const overall =
    c === "ok" && a === "ok" && snapshot.protocol.vaultsCount !== null
      ? "ok"
      : c === "off" && a === "off"
        ? "off"
        : "warn";

  return (
    <div className="border border-hairline bg-bg-elev/30">
      <div className="flex items-center justify-between px-4 h-9 border-b border-hairline">
        <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
          Protocol live
        </span>
        <span
          className={`font-mono text-[9px] uppercase tracking-kicker flex items-center gap-1.5 ${
            overall === "ok"
              ? "text-phosphor"
              : overall === "warn"
                ? "text-amber"
                : "text-ink-faint"
          }`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass(overall)}`}
          />
          {overall === "ok"
            ? "Operational"
            : overall === "warn"
              ? "Degraded"
              : "Offline"}
        </span>
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map((row) => (
          <ProtocolRow
            key={row.key}
            label={row.key}
            value={row.value}
            state={row.state}
          />
        ))}
      </ul>
      <div className="px-4 py-3 border-t border-hairline">
        <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
          Factory
        </div>
        <a
          href={snapshot.links.factoryExplorer}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-ink hover:text-amber transition-colors tabular truncate block"
        >
          {snapshot.protocol.factoryAddress.slice(0, 10)}…
          {snapshot.protocol.factoryAddress.slice(-8)} ↗
        </a>
      </div>
    </div>
  );
}
