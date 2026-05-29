"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LiveSnapshot } from "@/lib/live-state";
import { RelativeTime } from "@/components/relative-time";

function networkLabel(chainId: number): string {
  return chainId === 16661 ? "0G Mainnet" : "0G Galileo";
}

/**
 * Merge a fresh snapshot over the previous one, keeping the last known-good
 * value for on-chain aggregates that can transiently come back `null` — e.g.
 * one flaky RPC read among many makes `totalExecutions` incomplete, and the
 * server reports `null` rather than a too-low number. Without this the panel
 * would flash a wrong/blank figure for one poll before self-correcting.
 */
function mergeSnapshot(prev: LiveSnapshot, next: LiveSnapshot): LiveSnapshot {
  return {
    ...next,
    protocol: {
      ...next.protocol,
      vaultsCount: next.protocol.vaultsCount ?? prev.protocol.vaultsCount,
      standardVaultsCount:
        next.protocol.standardVaultsCount ?? prev.protocol.standardVaultsCount,
      v2VaultsCount: next.protocol.v2VaultsCount ?? prev.protocol.v2VaultsCount,
      totalTVL:
        next.protocol.totalTVL ??
        (next.protocol.totalTVLStatus === "unavailable" ? prev.protocol.totalTVL : null),
      totalTVLStatus:
        next.protocol.totalTVLStatus === "unavailable" && prev.protocol.totalTVL
          ? prev.protocol.totalTVLStatus
          : next.protocol.totalTVLStatus,
      standardExecutions:
        next.protocol.standardExecutions ?? prev.protocol.standardExecutions,
      v2Executions: next.protocol.v2Executions ?? prev.protocol.v2Executions,
      totalExecutions: next.protocol.totalExecutions ?? prev.protocol.totalExecutions,
    },
  };
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

function metricValue(value: number | null, suffix: string): string {
  return value !== null ? `${value.toLocaleString()} ${suffix}` : "read pending";
}

function ProtocolRow({
  label,
  value,
  state,
}: {
  label: string;
  value: ReactNode;
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
        if (mounted) setSnapshot((prev) => mergeSnapshot(prev, next));
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
      key: "Vault mix",
      value:
        snapshot.protocol.standardVaultsCount !== null &&
        snapshot.protocol.v2VaultsCount !== null
          ? `${snapshot.protocol.standardVaultsCount} Standard · ${snapshot.protocol.v2VaultsCount} Advanced`
          : "breakdown pending",
      state:
        snapshot.protocol.standardVaultsCount !== null &&
        snapshot.protocol.v2VaultsCount !== null
          ? "ok"
          : ("warn" as const),
    },
    {
      key: "Total TVL",
      value:
        snapshot.protocol.totalTVLStatus === "estimating"
          ? "TVL estimating"
          : snapshot.protocol.totalTVL !== null
          ? `$${snapshot.protocol.totalTVL}`
          : "on-chain read pending",
      state:
        snapshot.protocol.totalTVL !== null &&
        snapshot.protocol.totalTVLStatus === "ready"
          ? "ok"
          : ("warn" as const),
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
      key: "Exec mix",
      value:
        snapshot.protocol.standardExecutions !== null &&
        snapshot.protocol.v2Executions !== null
          ? `${metricValue(snapshot.protocol.standardExecutions, "Standard")} · ${metricValue(snapshot.protocol.v2Executions, "Advanced")}`
          : "breakdown pending",
      state:
        snapshot.protocol.standardExecutions !== null &&
        snapshot.protocol.v2Executions !== null
          ? "ok"
          : ("warn" as const),
    },
    {
      key: "Agent",
      value:
        snapshot.agent.status === "ready" ? (
          <>
            Active · last cycle{" "}
            <RelativeTime timestampMs={snapshot.agent.lastCycleAt} />
          </>
        ) : snapshot.agent.status === "initializing" ? (
          "Initializing"
        ) : snapshot.agent.status === "error" ? (
          "Setup error"
        ) : (
          "Unreachable"
        ),
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
