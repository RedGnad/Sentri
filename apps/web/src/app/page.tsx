import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LiveSystemPanel } from "@/components/live-system-panel";
import { getLiveSnapshot, type LiveSnapshot } from "@/lib/live-state";
import { DEMO_VAULT_ADDRESS } from "@/config/contracts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TRUST_TICKER = [
  "TEE-verified inference",
  "Agentic ID signer",
  "Single-use intent + deadline",
  "On-chain policy gate",
  "0G Storage Log/KV audit",
  "Slippage-guarded swap",
];

function networkLabel(chainId: number): string {
  return chainId === 16661 ? "0G Mainnet" : "0G Galileo";
}

function executionVenue(chainId: number): string {
  return chainId === 16661
    ? "Jaine USDC.E/W0G pool via adapter"
    : "SentriPair mock AMM";
}

function mechanism(chainId: number) {
  return [
    {
      id: "01",
      label: "Market + vault state",
      detail: "Fresh risk/base price and per-vault policy from 0G Chain",
    },
    {
      id: "02",
      label: "0G Compute + TEE",
      detail:
        "Private TeeML decision, verified with processResponse before execution",
    },
    {
      id: "03",
      label: "On-chain gate",
      detail:
        "Agentic ID, TEE signer, deadline, replay, exposure, drawdown, slippage",
    },
    {
      id: "04",
      label: "Swap + 0G Storage audit",
      detail: `${executionVenue(chainId)} · canonical Storage root + KV recovery index`,
    },
  ];
}

export default async function LandingPage() {
  const snapshot = await getLiveSnapshot();
  const mechanismRows = mechanism(snapshot.chain.id);
  const isMainnet = snapshot.chain.id === 16661;
  const demoVaultHref = `/v/${DEMO_VAULT_ADDRESS}`;

  return (
    <div className="relative">
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
            AI agents are getting wallets. Keep them on a leash : Sentri lets AI
            move capital without letting it go rogue.
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

        <div
          className="lg:col-span-4 animate-fade-up"
          style={{ animationDelay: "120ms" }}
        >
          <LiveSystemPanel initialSnapshot={snapshot} />
        </div>
      </section>

      {/* Trust ticker — single dense row */}
      <section
        className="mt-20 border-y border-hairline animate-fade-up"
        style={{ animationDelay: "160ms" }}
      >
        <div className="px-5 py-3 overflow-x-auto">
          <div className="inline-flex min-w-max items-center gap-4 font-mono text-[10px] uppercase tracking-kicker whitespace-nowrap">
            <span className="text-amber shrink-0">Trust path</span>
            <span className="text-ink-faint">·</span>
            {TRUST_TICKER.map((item, i) => (
              <span key={item} className="inline-flex items-center gap-4">
                <span className="text-ink">{item}</span>
                {i < TRUST_TICKER.length - 1 && (
                  <span className="text-ink-faint">·</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Execution path */}
      <section
        className="mt-8 mb-10 animate-fade-up"
        style={{ animationDelay: "220ms" }}
      >
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
                <span className="font-mono text-[10px] text-ink-faint tabular">
                  {step.id}
                </span>
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
        <span>
          {isMainnet
            ? "0G mainnet · USDC.E/W0G"
            : "Galileo rehearsal · MockUSDC/MockWETH"}
        </span>
        <FooterStatus snapshot={snapshot} />
      </footer>
    </div>
  );
}

function dotClass(state: "ok" | "warn" | "off"): string {
  if (state === "ok") return "bg-phosphor animate-pulse-dot";
  if (state === "warn") return "bg-amber";
  return "bg-ink-faint";
}

function FooterStatus({ snapshot }: { snapshot: LiveSnapshot }) {
  const chainLabel = networkLabel(snapshot.chain.id);
  const overall =
    snapshot.chain.rpcOk && snapshot.protocol.vaultsCount !== null
      ? snapshot.agent.ok
        ? "ok"
        : "warn"
      : "off";
  const label =
    overall === "ok"
      ? "Live"
      : overall === "warn"
        ? "Degraded"
        : "Chain unreachable";
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block w-1 h-1 rounded-full ${dotClass(overall)}`}
      />
      {label} · {chainLabel} {snapshot.chain.id}
    </span>
  );
}
