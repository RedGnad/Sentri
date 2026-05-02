import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getLiveSnapshot, formatRelative, type LiveSnapshot } from "@/lib/live-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRINCIPLES = [
  {
    num: "i",
    title: "Private by construction",
    body:
      "Strategy reasoning executes inside a Trusted Execution Environment via 0G Sealed Inference. The alpha never leaves the enclave — not to RPC, not to logs, not to the operator.",
  },
  {
    num: "ii",
    title: "Verifiable by default",
    body:
      "Every decision is sealed with a TEE attestation hash and a cryptographic proof hash, anchored on-chain and mirrored to 0G Storage. Auditors can replay the trail without the secret.",
  },
  {
    num: "iii",
    title: "Bounded by policy",
    body:
      "Max allocation, drawdown, cooldown and slippage live in the vault contract. The agent proposes; the contract disposes. No override path exists.",
  },
];

const MECHANISM = [
  { id: "01", label: "Market snapshot", detail: "ETH/USD pulled from multiple oracles" },
  { id: "02", label: "Push price on-chain", detail: "Agent is sole keeper of SentriPriceFeed" },
  { id: "03", label: "Sealed inference", detail: "TEE analyzes state · returns decision" },
  { id: "04", label: "Proof sealed", detail: "Hash reasoning · attest enclave" },
  { id: "05", label: "Policy check", detail: "On-chain allocation / drawdown / cooldown" },
  { id: "06", label: "Execute", detail: "Swap routed through SentriPair AMM" },
  { id: "07", label: "Audit log", detail: "Event on-chain + entry written to 0G Storage" },
  { id: "08", label: "Heartbeat", detail: "Portfolio snapshot pushed to 0G Storage KV" },
  { id: "09", label: "Kill-switch", detail: "Owner can halt and drain at any time" },
];

const STACK_ROWS = [
  { layer: "Settlement", component: "TreasuryVault.sol", purpose: "Funds, policy engine, execution gate" },
  { layer: "Identity", component: "AgentINFT.sol", purpose: "Enclave measurement + revocation" },
  { layer: "Execution", component: "SentriSwapRouter", purpose: "Uniswap v2 router, 0.3% fee" },
  { layer: "Liquidity", component: "SentriPair", purpose: "Constant-product AMM (USDC/WETH)" },
  { layer: "Oracle", component: "SentriPriceFeed", purpose: "AggregatorV3 pushed by agent" },
  { layer: "Inference", component: "0G Sealed Inference", purpose: "Private strategy in TEE" },
  { layer: "Storage", component: "0G Storage KV + Log", purpose: "Audit trail + live state" },
];

export default async function LandingPage() {
  const snapshot = await getLiveSnapshot();

  return (
    <div className="relative">
      {/* Meta bar */}
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-kicker text-ink-faint pb-6 border-b border-hairline">
        <span>Sentri · Verifiable Treasury Execution</span>
        <span className="hidden sm:inline">0G APAC Hackathon 2026 · Track II · Verifiable Finance</span>
        <span>Galileo {snapshot.chain.id}</span>
      </div>

      {/* Hero */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-16 pb-24">
        <div className="lg:col-span-8 animate-fade-up">
          <div className="font-mono text-[10px] uppercase tracking-kicker text-amber mb-6 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-amber animate-pulse-dot" />
            Issue i · MMXXVI · Built on 0G
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
          <p className="text-[15px] text-ink-dim max-w-xl mt-8 leading-relaxed">
            Sentri is an autonomous, risk-managed stablecoin treasury agent. It plans privately
            inside a <span className="text-ink">Trusted Execution Environment</span>, executes
            under on-chain risk policies it cannot override, and publishes
            cryptographic proofs of every decision — without revealing the strategy.
          </p>
          <div className="flex items-center gap-3 mt-10">
            <Link href="/vault">
              <Button size="lg">Open Dashboard →</Button>
            </Link>
            <Link href="/audit">
              <Button size="lg" variant="outline">
                View Audit Trail
              </Button>
            </Link>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mt-4">
            ↓ Audit page is read-only · no wallet required
          </p>
        </div>

        {/* Live system panel */}
        <div className="lg:col-span-4 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <LiveSystemPanel snapshot={snapshot} />
        </div>
      </section>

      {/* Section I — Principles */}
      <SectionHeader num="I" title="Principles" />
      <section className="grid grid-cols-1 md:grid-cols-3 gap-0 border-y border-hairline animate-fade-up" style={{ animationDelay: "200ms" }}>
        {PRINCIPLES.map((p, i) => (
          <div
            key={p.num}
            className={`p-8 ${i < 2 ? "md:border-r md:border-hairline" : ""} ${
              i > 0 ? "border-t md:border-t-0 border-hairline" : ""
            }`}
          >
            <div className="flex items-baseline gap-3 mb-4">
              <span className="font-serif italic text-3xl text-amber">{p.num}.</span>
              <h3 className="font-serif text-xl text-ink leading-tight">{p.title}</h3>
            </div>
            <p className="text-[13px] text-ink-dim leading-relaxed">{p.body}</p>
          </div>
        ))}
      </section>

      {/* Section II — Mechanism */}
      <SectionHeader num="II" title="Mechanism" subtitle="The loop, in nine steps" />
      <section className="border border-hairline bg-bg-elev/20 mb-24 animate-fade-up">
        <div className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
            agent.loop()
          </span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
            while (running)
          </span>
        </div>
        <ol className="divide-y divide-hairline">
          {MECHANISM.map((step) => (
            <li
              key={step.id}
              className="grid grid-cols-[60px_1fr_auto] items-center gap-6 px-5 h-14 hover:bg-bg-elev/40 transition-colors group"
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
      </section>

      {/* Section III — Stack */}
      <SectionHeader num="III" title="The Stack" subtitle="Seven layers · five 0G components" />
      <section className="border border-hairline mb-24 animate-fade-up">
        <div className="grid grid-cols-[1fr_1.2fr_2fr] border-b border-hairline bg-bg-elev/40 h-9 items-center px-5">
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">Layer</span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">Component</span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint hidden sm:inline">Purpose</span>
        </div>
        <ul className="divide-y divide-hairline">
          {STACK_ROWS.map((row) => (
            <li
              key={row.layer}
              className="grid grid-cols-[1fr_1.2fr_2fr] items-center px-5 h-12 hover:bg-bg-elev/40 transition-colors"
            >
              <span className="font-serif italic text-[15px] text-ink-dim">{row.layer}</span>
              <span className="font-mono text-[11px] text-ink">{row.component}</span>
              <span className="font-mono text-[10px] text-ink-dim hidden sm:inline">
                {row.purpose}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Manifesto / Closing */}
      <section className="py-20 border-t border-hairline text-center animate-fade-up">
        <p className="font-serif italic text-3xl sm:text-4xl lg:text-5xl text-ink-dim max-w-3xl mx-auto leading-tight">
          A treasurer you can trust because{" "}
          <span className="text-amber">you do not have to</span>.
        </p>
        <div className="flex items-center justify-center gap-3 mt-12">
          <Link href="/vault">
            <Button size="lg">Enter the Vault →</Button>
          </Link>
        </div>
      </section>

      {/* Footer meta */}
      <footer className="border-t border-hairline pt-8 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
        <span>© MMXXVI · Sentri · MIT License</span>
        <span>0G APAC Hackathon · Verifiable Finance</span>
        <FooterStatus snapshot={snapshot} />
      </footer>
    </div>
  );
}

function SectionHeader({
  num,
  title,
  subtitle,
}: {
  num: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-6 mt-4">
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
          § {num}
        </span>
        <h2 className="font-serif text-4xl sm:text-5xl text-ink tracking-tightest">
          {title}
        </h2>
      </div>
      {subtitle && (
        <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint hidden sm:inline">
          {subtitle}
        </span>
      )}
    </div>
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
  if (!snapshot.agent.lastIterationAt) return "warn";
  const ageMs = Date.now() - snapshot.agent.lastIterationAt;
  const intervalMs = (snapshot.agent.intervalSec ?? 300) * 1000;
  if (ageMs > intervalMs * 3) return "warn";
  return "ok";
}

function vaultState(snapshot: LiveSnapshot): "ok" | "warn" | "off" {
  if (snapshot.vault.totalValue === null) return "off";
  if (snapshot.vault.isKilled) return "off";
  if (snapshot.vault.isPaused) return "warn";
  return "ok";
}

function LiveSystemPanel({ snapshot }: { snapshot: LiveSnapshot }) {
  const c = chainState(snapshot);
  const a = agentState(snapshot);
  const v = vaultState(snapshot);

  const rows = [
    {
      key: "Chain",
      value: snapshot.chain.rpcOk
        ? `Galileo · block #${snapshot.chain.blockNumber} · ${snapshot.chain.blockAgeSec}s`
        : "RPC unreachable",
      state: c,
    },
    {
      key: "Vault",
      value:
        snapshot.vault.totalValue !== null
          ? `$${snapshot.vault.totalValue} · ${snapshot.vault.executionLogCount} exec`
          : "—",
      state: v,
    },
    {
      key: "Agent",
      value:
        snapshot.agent.status === "ready"
          ? `${snapshot.agent.totalIterations ?? 0} iter · ${formatRelative(
              snapshot.agent.lastIterationAt,
            )}`
          : snapshot.agent.status === "initializing"
          ? "Initializing"
          : snapshot.agent.status === "error"
          ? "Setup error"
          : "Unreachable",
      state: a,
    },
    {
      key: "Model",
      value:
        snapshot.agent.model
          ? snapshot.agent.model.slice(0, 22) + (snapshot.agent.model.length > 22 ? "…" : "")
          : "—",
      state: snapshot.agent.model ? "ok" : "off",
    },
    {
      key: "Cadence",
      value: snapshot.agent.intervalSec ? `every ${snapshot.agent.intervalSec}s` : "—",
      state: snapshot.agent.intervalSec ? "ok" : "off",
    },
  ] as const;

  const overall = c === "ok" && v === "ok" && a === "ok" ? "ok" : a === "off" || c === "off" ? "off" : "warn";

  return (
    <div className="border border-hairline bg-bg-elev/30">
      <div className="flex items-center justify-between px-4 h-9 border-b border-hairline">
        <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
          Live system
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
          <li key={row.key} className="flex items-center justify-between px-4 h-11 gap-3">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint shrink-0">
              {row.key}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink flex items-center gap-2 truncate">
              <span className="truncate">{row.value}</span>
              <span className={`inline-block w-1 h-1 rounded-full shrink-0 ${dotClass(row.state)}`} />
            </span>
          </li>
        ))}
      </ul>
      <div className="px-4 py-3 border-t border-hairline">
        <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
          Last execution
        </div>
        <div className="font-mono text-[11px] text-ink tabular">
          {snapshot.agent.lastIterationAt
            ? `${formatRelative(snapshot.agent.lastIterationAt)} · ${snapshot.agent.lastIterationStatus ?? "—"}`
            : "no run yet"}
        </div>
      </div>
    </div>
  );
}

function FooterStatus({ snapshot }: { snapshot: LiveSnapshot }) {
  const overall =
    snapshot.chain.rpcOk && snapshot.vault.totalValue !== null
      ? snapshot.agent.ok
        ? "ok"
        : "warn"
      : "off";
  const label = overall === "ok" ? "Live" : overall === "warn" ? "Degraded" : "Chain unreachable";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-1 h-1 rounded-full ${dotClass(overall)}`} />
      {label} · Galileo {snapshot.chain.id}
    </span>
  );
}
