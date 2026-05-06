import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getLiveSnapshot, formatRelative, type LiveSnapshot } from "@/lib/live-state";
import { DEMO_VAULT_ADDRESS } from "@/config/contracts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TRUST_TICKER = [
  "TEE-verified inference",
  "INFT-bound signer",
  "Single-use intent + deadline",
  "On-chain policy gate",
  "0G Storage audit",
  "Slippage-guarded swap",
];

function networkLabel(chainId: number): string {
  return chainId === 16661 ? "0G Mainnet" : "0G Galileo";
}

function executionVenue(chainId: number): string {
  return chainId === 16661 ? "Jaine USDC.E/W0G pool via adapter" : "SentriPair mock AMM";
}

function mechanism(chainId: number) {
  return [
    { id: "01", label: "Market + vault state", detail: "Fresh risk/base price and per-vault policy" },
    { id: "02", label: "0G sealed inference", detail: "Private decision, verified before execution" },
    { id: "03", label: "On-chain gate", detail: "TEE signer, deadline, replay, exposure, drawdown, slippage" },
    { id: "04", label: "Swap + audit", detail: `${executionVenue(chainId)} · event + 0G Storage KV` },
  ];
}

export default async function LandingPage() {
  const snapshot = await getLiveSnapshot();
  const chainLabel = networkLabel(snapshot.chain.id);
  const mechanismRows = mechanism(snapshot.chain.id);
  const isMainnet = snapshot.chain.id === 16661;
  const demoVaultHref = `/v/${DEMO_VAULT_ADDRESS}`;

  return (
    <div className="relative">
      {/* Meta bar */}
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-kicker text-ink-faint pb-5 border-b border-hairline">
        <span>Sentri · Treasury Vaults</span>
        <span className="hidden sm:inline">Private agent decisions · public risk controls</span>
        <span>{chainLabel} · {snapshot.chain.id}</span>
      </div>

      {/* Hero + Live panel */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-10 pb-12">
        <div className="lg:col-span-8 animate-fade-up">
          <div className="font-mono text-[10px] uppercase tracking-kicker text-amber mb-6 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-amber animate-pulse-dot" />
            Live treasury infrastructure on 0G
          </div>
          <h1 className="font-serif text-[64px] sm:text-[88px] lg:text-[112px] leading-[0.92] tracking-tightest text-ink">
            Your AI
            <br />
            <em className="italic text-amber">Treasurer</em>
            <span className="cursor-block" />
          </h1>
          <p className="font-serif italic text-2xl sm:text-3xl text-ink-dim mt-6 max-w-2xl leading-snug">
            Private strategy. Verifiable results.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mt-3">
            Stables-first · Bounded risk · Owner-controlled
          </p>
          <p className="text-[16px] text-ink-dim max-w-xl mt-8 leading-relaxed">
            Sentri turns treasury reserves into bounded productive capital: privately
            decided in a TEE, executed only when on-chain policy allows it.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-8">
            <Link href="/deploy">
              <Button size="lg">Deploy Vault →</Button>
            </Link>
            <Link href={demoVaultHref}>
              <Button size="lg" variant="outline">
                Open Demo Vault
              </Button>
            </Link>
            <Link href="/vaults">
              <Button size="lg" variant="outline">
                All Vaults
              </Button>
            </Link>
          </div>
        </div>

        <div className="lg:col-span-4 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <LiveSystemPanel snapshot={snapshot} />
        </div>
      </section>

      {/* Trust ticker — single dense row */}
      <section className="border-y border-hairline animate-fade-up" style={{ animationDelay: "160ms" }}>
        <div className="px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-kicker">
          <span className="text-amber">Trust path</span>
          {TRUST_TICKER.map((item, i) => (
            <span key={item} className="flex items-center gap-x-5">
              <span className="text-ink">{item}</span>
              {i < TRUST_TICKER.length - 1 && <span className="text-ink-faint">·</span>}
            </span>
          ))}
        </div>
      </section>

      {/* Execution path */}
      <section className="mt-8 mb-10 animate-fade-up" style={{ animationDelay: "220ms" }}>
        <div className="border border-hairline bg-bg-elev/20">
          <div className="flex items-center justify-between px-5 h-9 border-b border-hairline">
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
              Execution path · per cycle
            </span>
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
              {executionVenue(snapshot.chain.id)}
            </span>
          </div>
          <ol className="divide-y divide-hairline">
            {mechanismRows.map((step) => (
              <li
                key={step.id}
                className="grid grid-cols-[48px_1fr] sm:grid-cols-[48px_1fr_1.6fr] items-center gap-4 px-5 min-h-14 py-3 hover:bg-bg-elev/40 transition-colors group"
              >
                <span className="font-mono text-[10px] text-ink-faint tabular">{step.id}</span>
                <span className="font-mono text-[11px] uppercase tracking-kicker text-ink group-hover:text-amber transition-colors">
                  {step.label}
                </span>
                <span className="font-mono text-[10px] text-ink-dim hidden sm:inline">
                  {step.detail}
                </span>
              </li>
            ))}
          </ol>
          <div className="px-5 py-4 border-t border-hairline">
            <p className="font-serif italic text-lg text-ink-dim leading-snug">
              One verified operator. Your vault, your policy.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-hairline pt-8 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
        <span>© MMXXVI · Sentri · MIT License</span>
        <span>{isMainnet ? "0G mainnet · USDC.E/W0G" : "Galileo rehearsal · MockUSDC/MockWETH"}</span>
        <FooterStatus snapshot={snapshot} />
      </footer>
    </div>
  );
}

function ProtocolRow({ label, value, state }: { label: string; value: string; state: "ok" | "warn" | "off" }) {
  return (
    <li className="flex items-center justify-between px-4 h-11 gap-3">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint shrink-0">
        {label}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink flex items-center gap-2 truncate">
        <span className="truncate">{value}</span>
        <span className={`inline-block w-1 h-1 rounded-full shrink-0 ${dotClass(state)}`} />
      </span>
    </li>
  );
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
  const ageMs = Date.now() - snapshot.agent.lastCycleAt;
  const intervalMs = (snapshot.agent.intervalSec ?? 300) * 1000;
  if (ageMs > intervalMs * 3) return "warn";
  return "ok";
}

function LiveSystemPanel({ snapshot }: { snapshot: LiveSnapshot }) {
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
      value: snapshot.protocol.vaultsCount !== null ? `${snapshot.protocol.vaultsCount} live` : "protocol read failed",
      state: snapshot.protocol.vaultsCount !== null ? "ok" : ("warn" as const),
    },
    {
      key: "Total TVL",
      value: snapshot.protocol.totalTVL !== null ? `$${snapshot.protocol.totalTVL}` : "on-chain read pending",
      state: snapshot.protocol.totalTVL !== null ? "ok" : ("warn" as const),
    },
    {
      key: "Executions",
      value: snapshot.protocol.totalExecutions !== null
        ? `${snapshot.protocol.totalExecutions.toLocaleString()} total`
        : "on-chain read pending",
      state: snapshot.protocol.totalExecutions !== null ? "ok" : ("warn" as const),
    },
    {
      key: "Agent",
      value:
        snapshot.agent.status === "ready"
          ? `${snapshot.agent.cycles ?? 0} cycles · ${formatRelative(snapshot.agent.lastCycleAt)}`
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
        ? snapshot.agent.model.slice(0, 22) + (snapshot.agent.model.length > 22 ? "…" : "")
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
            overall === "ok" ? "text-phosphor" : overall === "warn" ? "text-amber" : "text-ink-faint"
          }`}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass(overall)}`} />
          {overall === "ok" ? "Operational" : overall === "warn" ? "Degraded" : "Offline"}
        </span>
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map((row) => (
          <ProtocolRow key={row.key} label={row.key} value={row.value} state={row.state} />
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
          {snapshot.protocol.factoryAddress.slice(0, 10)}…{snapshot.protocol.factoryAddress.slice(-8)} ↗
        </a>
      </div>
    </div>
  );
}

function FooterStatus({ snapshot }: { snapshot: LiveSnapshot }) {
  const chainLabel = networkLabel(snapshot.chain.id);
  const overall =
    snapshot.chain.rpcOk && snapshot.protocol.vaultsCount !== null
      ? snapshot.agent.ok
        ? "ok"
        : "warn"
      : "off";
  const label = overall === "ok" ? "Live" : overall === "warn" ? "Degraded" : "Chain unreachable";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-1 h-1 rounded-full ${dotClass(overall)}`} />
      {label} · {chainLabel} {snapshot.chain.id}
    </span>
  );
}
