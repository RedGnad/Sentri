"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useReadContracts } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { TREASURY_VAULT_ABI } from "@/config/contracts";
import { formatUSDC } from "@/lib/utils";
import { BASE_SYMBOL, RISK_SYMBOL } from "@/config/contracts";
import { Skeleton } from "@/components/ui/skeleton";
import { useParsedVaultData } from "@/hooks/use-vault";
import {
  useVaultAuditDetail,
  useVaultRejections,
  type VaultRejectionEntry,
} from "@/hooks/use-vault-runtime";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldX,
  ShieldCheck,
  Copy,
  Check,
} from "lucide-react";
import { SkillMintSignalBlock } from "@/components/skillmint-signal-block";
import { galileo } from "@/config/wagmi";

const ACTION_LABELS = [
  "Rebalance",
  "YieldFarm",
  "Risk trim",
] as const;
const ACTION_VARIANTS = ["default", "success", "warning"] as const;
const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? galileo.blockExplorers.default.url;
const STORAGE_SCAN =
  process.env.NEXT_PUBLIC_STORAGE_SCAN_URL ?? "https://storagescan-galileo.0g.ai";

function CopyableHash({
  value,
  slice = 18,
}: {
  value: string;
  slice?: number;
}) {
  const [copied, setCopied] = useState(false);
  const display =
    value.length > slice + 4
      ? `${value.slice(0, slice)}…${value.slice(-4)}`
      : value;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="font-mono text-[11px] text-ink-dim break-all flex items-center gap-1.5 hover:text-ink transition-colors text-left"
      title="Copy to clipboard"
    >
      <span>{display}</span>
      {copied ? (
        <Check className="h-3 w-3 text-phosphor shrink-0" />
      ) : (
        <Copy className="h-3 w-3 text-ink-faint shrink-0" />
      )}
    </button>
  );
}

function ExplorerAddress({ value, label }: { value: string; label?: string }) {
  const display = label ?? `${value.slice(0, 6)}…${value.slice(-4)}`;
  return (
    <a
      href={`${EXPLORER}/address/${value}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-[12px] text-amber hover:underline tabular flex items-center gap-1"
    >
      {display} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function formatRiskDisplay(value: bigint): string {
  const num = Number(value) / 1e18;
  if (num === 0) return "0";
  if (num > 0 && num < 0.0001) return "< 0.0001";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function isDustExecution(amountIn: bigint, amountOut: bigint): boolean {
  return (
    amountIn > 0n &&
    amountIn < 1_000_000_000_000_000n &&
    amountOut > 0n &&
    amountOut < 10_000n
  );
}

export default function VaultAuditPage() {
  const params = useParams<{ address: string }>();
  const address = params.address as `0x${string}`;

  const { data: vault, isLoading: vaultLoading } = useParsedVaultData(address);
  const logCount = vault ? Number(vault.logCount) : 0;
  const { data: rejectionsData } = useVaultRejections(address);
  const visibleRejections =
    rejectionsData?.entries.filter(
      (entry) => entry.errorCode !== "CooldownNotElapsed",
    ) ?? [];
  const blockedActions = visibleRejections.filter(
    (entry) => entry.type !== "defensive-override",
  );
  const verifierHolds = visibleRejections.filter(
    (entry) => entry.type === "defensive-override",
  );
  const [rejectionsExpanded, setRejectionsExpanded] = useState(false);

  const logContracts = Array.from(
    { length: Math.min(logCount, 50) },
    (_, i) => ({
      address,
      abi: TREASURY_VAULT_ABI,
      chainId: galileo.id,
      functionName: "executionLogs" as const,
      args: [BigInt(logCount - 1 - i)] as const,
    }),
  );

  const { data: logs } = useReadContracts({
    contracts: logContracts,
    query: { enabled: logCount > 0 },
  });

  if (vaultLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-serif text-2xl text-ink">
          {logCount} execution{logCount === 1 ? "" : "s"}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">
          Public · no wallet required · verifiable on-chain
        </span>
      </div>

      {visibleRejections.length > 0 && (
        <div className="border border-hairline bg-bg-elev/10 mb-4">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            onClick={() => setRejectionsExpanded((v) => !v)}
          >
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-kicker">
              {blockedActions.length > 0 && (
                <span className="flex items-center gap-2 text-alert">
                  <ShieldX className="h-3.5 w-3.5" />
                  {blockedActions.length} blocked action
                  {blockedActions.length === 1 ? "" : "s"}
                </span>
              )}
              {verifierHolds.length > 0 && (
                <span className="flex items-center gap-2 text-amber">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {verifierHolds.length} verifier hold
                  {verifierHolds.length === 1 ? "" : "s"}
                </span>
              )}
            </span>
            {rejectionsExpanded ? (
              <ChevronUp className="h-4 w-4 text-ink-dim" />
            ) : (
              <ChevronDown className="h-4 w-4 text-ink-dim" />
            )}
          </button>
          {rejectionsExpanded && (
            <div className="border-t border-hairline px-4 pb-3 divide-y divide-hairline">
              {[...blockedActions, ...verifierHolds].map((r, i) => (
                <RejectionRow key={i} entry={r} />
              ))}
            </div>
          )}
        </div>
      )}

      {logCount === 0 ? (
        <div className="border border-hairline bg-bg-elev/20 py-20 text-center">
          <p className="font-serif italic text-xl text-ink-dim mb-2">
            No executions yet on this vault.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
            The agent will append decisions here as it operates.
          </p>
        </div>
      ) : (
        logs?.map((log, i) => {
          if (!log.result) return null;
          const [
            timestamp,
            action,
            amountIn,
            amountOut,
            tvlAfter,
            intentHash,
            responseHash,
            teeSigner,
            teeAttestation,
            deadline,
          ] = log.result as [
            bigint,
            number,
            bigint,
            bigint,
            bigint,
            string,
            string,
            string,
            string,
            bigint,
          ];
          return (
            <AuditEntry
              key={i}
              vaultAddress={address}
              index={i}
              logCount={logCount}
              timestamp={timestamp}
              action={action}
              amountIn={amountIn}
              amountOut={amountOut}
              tvlAfter={tvlAfter}
              intentHash={intentHash}
              responseHash={responseHash}
              teeSigner={teeSigner}
              teeAttestation={teeAttestation}
              deadline={deadline}
            />
          );
        })
      )}
    </div>
  );
}

function AuditEntry({
  vaultAddress,
  index,
  logCount,
  timestamp,
  action,
  amountIn,
  amountOut,
  tvlAfter,
  intentHash,
  responseHash,
  teeSigner,
  teeAttestation,
  deadline,
}: {
  vaultAddress: `0x${string}`;
  index: number;
  logCount: number;
  timestamp: bigint;
  action: number;
  amountIn: bigint;
  amountOut: bigint;
  tvlAfter: bigint;
  intentHash: string;
  responseHash: string;
  teeSigner: string;
  teeAttestation: string;
  deadline: bigint;
}) {
  const [expanded, setExpanded] = useState(false);
  const tsMs = Number(timestamp) * 1000;
  const { data: detail } = useVaultAuditDetail(
    expanded ? vaultAddress : undefined,
    expanded ? tsMs : null,
  );

  // Reveal is a single, stable phase: from the moment the panel opens it shows
  // one continuous "decrypting" state until the enriched reasoning arrives
  // (the agent writes it shortly after execution and the hook polls for it).
  // Only if it has not arrived after a grace window do we show the terminal
  // "not indexed" message — this avoids flickering loading ↔ not-indexed while
  // the background poll is still in flight.
  const [revealTimedOut, setRevealTimedOut] = useState(false);
  const hasEnrichedReasoning = Boolean(detail?.reasoning);
  const detailIsTerminalFallback =
    Boolean(detail) &&
    !hasEnrichedReasoning &&
    (detail?.source === "chain-fallback" || detail?.source === "no-context");
  useEffect(() => {
    if (!expanded) {
      setRevealTimedOut(false);
      return;
    }
    if (hasEnrichedReasoning || detailIsTerminalFallback) return; // already resolved — no timer needed
    const timer = setTimeout(() => setRevealTimedOut(true), 26_000);
    return () => clearTimeout(timer);
  }, [expanded, hasEnrichedReasoning, detailIsTerminalFallback]);

  const date = new Date(tsMs);
  const dustExecution = action === 2 && isDustExecution(amountIn, amountOut);
  const actionLabel = dustExecution
    ? "Dust cleanup"
    : (ACTION_LABELS[action] ?? "Unknown");
  const variant = dustExecution
    ? "default"
    : (ACTION_VARIANTS[action] ?? "default");
  const logId = String(logCount - 1 - index).padStart(4, "0");

  return (
    <article className="border border-hairline bg-bg-elev/20 hover:bg-bg-elev/40 transition-colors">
      <header className="flex items-center justify-between px-5 h-10 border-b border-hairline">
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-ink-dim tabular">
            log/{logId}
          </span>
          <Badge variant={variant as "default" | "success" | "destructive" | "warning"}>
            {actionLabel}
          </Badge>
        </div>
        <span className="font-mono text-[10px] text-ink-faint tabular" title={`${date.toISOString().slice(0, 19)} UTC`}>
          {date.toLocaleString([], { dateStyle: "short", timeStyle: "medium" })}
        </span>
      </header>

      <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        <Field label="Amount in">
          <span className="font-serif text-2xl text-ink tabular">
            {action === 2
              ? `${formatRiskDisplay(amountIn)}`
              : `$${formatUSDC(amountIn)}`}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint ml-1.5">
            {action === 2 ? RISK_SYMBOL : BASE_SYMBOL}
          </span>
        </Field>
        <Field label="Amount out">
          <span className="font-serif text-2xl text-amber tabular">
            {dustExecution
              ? "< $0.01"
              : action === 2
                ? `$${formatUSDC(amountOut)}`
                : `${formatRiskDisplay(amountOut)}`}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint ml-1.5">
            {action === 2 ? BASE_SYMBOL : RISK_SYMBOL}
          </span>
        </Field>
        <Field label="TVL after">
          <span className="font-serif text-2xl text-ink tabular">
            ${formatUSDC(tvlAfter)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint ml-1.5">
            {BASE_SYMBOL}
          </span>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 border-t border-hairline">
        <div className="px-5 py-4 md:border-r border-hairline">
          <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
            Intent hash
          </div>
          <code className="font-mono text-[11px] text-ink-dim break-all">
            {intentHash}
          </code>
        </div>
        <div className="px-5 py-4 border-t md:border-t-0 border-hairline">
          <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
            Response hash
          </div>
          <code className="font-mono text-[11px] text-ink-dim break-all">
            {responseHash}
          </code>
        </div>
      </div>
      <div className="border-t border-hairline px-5 py-4">
        <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
          Intent deadline
        </div>
        <code className="font-mono text-[11px] text-ink-dim break-all" title={`${new Date(Number(deadline) * 1000).toISOString().slice(0, 19)} UTC`}>
          {new Date(Number(deadline) * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "medium" })}
        </code>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 border-t border-hairline">
        <div className="px-5 py-4 md:border-r border-hairline">
          <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
            TEE signer
          </div>
          <code className="font-mono text-[11px] text-ink-dim break-all">
            {teeSigner}
          </code>
        </div>
        <div className="px-5 py-4 border-t md:border-t-0 border-hairline">
          <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
            TEE attestation
          </div>
          <code className="font-mono text-[11px] text-ink-dim break-all">
            {teeAttestation}
          </code>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 h-12 border-t border-hairline font-mono text-[11px] uppercase tracking-kicker text-amber hover:text-ink transition-colors"
      >
        <span>∎ {expanded ? "Hide" : "Reveal"} TEE reasoning</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-hairline px-5 py-5 bg-bg-sunk/40">
          {!hasEnrichedReasoning && !detailIsTerminalFallback && !revealTimedOut ? (
            <p className="font-mono text-[11px] text-ink-faint">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse-dot mr-2 align-middle" />
              Decrypting sealed inference — fetching the TEE-signed reasoning…
            </p>
          ) : detail && detail.reasoning ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-kicker text-phosphor">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot" />
                Sealed Inference · TEE Signature Verified
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-2">
                  Agent reasoning
                </div>
                <p className="font-serif italic text-[16px] text-ink leading-relaxed">
                  &ldquo;{detail.reasoning}&rdquo;
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-hairline pt-4">
                <Field label="Decision score">
                  <span className="font-serif text-2xl text-amber tabular">
                    {Math.min(detail.confidence, 95)}%
                  </span>
                </Field>
                <Field label="Hash match">
                  <span
                    className={`font-mono text-[12px] tabular ${detail.intentHash === intentHash && detail.responseHash === responseHash ? "text-phosphor" : "text-alert"}`}
                  >
                    {detail.intentHash === intentHash &&
                    detail.responseHash === responseHash
                      ? "MATCH"
                      : "MISMATCH"}
                  </span>
                </Field>
                <Field label="Provider">
                  {detail.provider ? (
                    <ExplorerAddress
                      value={detail.provider}
                      label={`${detail.provider.slice(0, 6)}…${detail.provider.slice(-4)}`}
                    />
                  ) : (
                    <span className="font-mono text-[11px] text-ink-dim">
                      -
                    </span>
                  )}
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-hairline pt-4">
                <Field label="Verifiability">
                  <span className="font-mono text-[11px] text-ink-dim tabular">
                    {detail.verifiability || "-"}
                  </span>
                </Field>
                <Field label="processResponse">
                  <span
                    className={`font-mono text-[11px] tabular ${detail.processResponseVerified ? "text-phosphor" : "text-alert"}`}
                  >
                    {detail.processResponseVerified ? "VERIFIED" : "MISSING"}
                  </span>
                </Field>
                <Field label="Signer matched provider">
                  <span
                    className={`font-mono text-[11px] tabular ${detail.signerMatchedProvider ? "text-phosphor" : "text-alert"}`}
                  >
                    {detail.signerMatchedProvider ? "MATCH" : "UNKNOWN"}
                  </span>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-hairline pt-4">
                <Field label="Chat ID">
                  {detail.chatID ? (
                    <CopyableHash value={detail.chatID} slice={22} />
                  ) : (
                    <span className="font-mono text-[11px] text-ink-dim">
                      -
                    </span>
                  )}
                </Field>
                <Field label="Recovered signer">
                  {detail.recoveredSigner ? (
                    <ExplorerAddress value={detail.recoveredSigner} />
                  ) : (
                    <span className="font-mono text-[11px] text-ink-dim">
                      -
                    </span>
                  )}
                </Field>
                <Field label="Signed payload hash">
                  {detail.signedPayloadHash ? (
                    <CopyableHash value={detail.signedPayloadHash} />
                  ) : (
                    <span className="font-mono text-[11px] text-ink-dim">
                      -
                    </span>
                  )}
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-hairline pt-4">
                <Field label="Market quorum">
                  <span className="font-mono text-[11px] text-ink-dim tabular">
                    {detail.marketSourceCount != null
                      ? `${detail.marketSourceCount}/${detail.marketRequiredSourceCount ?? 2}`
                      : "-"}
                  </span>
                </Field>
                <Field label="Market spread">
                  <span className="font-mono text-[11px] text-ink-dim tabular">
                    {typeof detail.marketSpreadPct === "number"
                      ? `${detail.marketSpreadPct.toFixed(3)}%`
                      : "-"}
                  </span>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-hairline pt-4">
                {detail.txHash ? (
                  <Field label="Vault TX">
                    <a
                      href={`${EXPLORER}/tx/${detail.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-amber hover:underline tabular flex items-center gap-1"
                    >
                      {detail.txHash.slice(0, 10)}…{" "}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Field>
                ) : (
                  <Field label="Vault TX">
                    <span className="font-mono text-[11px] text-ink-faint">not recorded</span>
                  </Field>
                )}
                {(detail.canonicalStorageTxHash ?? detail.storageTxHash) ? (
                  <Field label="Canonical blob TX">
                    <a
                      href={`${EXPLORER}/tx/${detail.canonicalStorageTxHash ?? detail.storageTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-amber hover:underline tabular flex items-center gap-1"
                    >
                      {(detail.canonicalStorageTxHash ?? detail.storageTxHash)!.slice(0, 10)}…{" "}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Field>
                ) : (
                  <Field label="Canonical blob TX">
                    <span className="font-mono text-[11px] text-ink-faint">not recorded</span>
                  </Field>
                )}
                {(detail.canonicalRootHash ?? detail.storageRootHash) ? (
                  <Field label="Canonical root">
                    <div className="space-y-1">
                      <CopyableHash value={(detail.canonicalRootHash ?? detail.storageRootHash)!} />
                      <a
                        href={`${STORAGE_SCAN}/file/${detail.canonicalRootHash ?? detail.storageRootHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-amber hover:underline flex items-center gap-1"
                      >
                        StorageScan <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </Field>
                ) : (
                  <Field label="Canonical root">
                    <span className="font-mono text-[11px] text-ink-faint">not recorded</span>
                  </Field>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-hairline pt-4">
                {detail.kvIndexTxHash && (
                  <Field label="KV index TX">
                    <a
                      href={`${EXPLORER}/tx/${detail.kvIndexTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-amber hover:underline tabular flex items-center gap-1"
                    >
                      {detail.kvIndexTxHash.slice(0, 10)}…{" "}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Field>
                )}
                {detail.kvIndexRootHash && (
                  <Field label="KV index root">
                    <CopyableHash value={detail.kvIndexRootHash} />
                  </Field>
                )}
                {detail.canonicalRecordHash && (
                  <Field label="Record hash">
                    <CopyableHash value={detail.canonicalRecordHash} />
                  </Field>
                )}
              </div>
              {(detail.storageError ||
                detail.canonicalStorageError ||
                detail.kvIndexError) && (
                <div className="border-t border-hairline pt-4">
                  <div className="font-mono text-[9px] uppercase tracking-kicker text-alert mb-1.5">
                    0G Storage write warning
                  </div>
                  <p className="font-mono text-[11px] text-alert/80 break-all">
                    {detail.storageError ||
                      detail.canonicalStorageError ||
                      detail.kvIndexError}
                  </p>
                </div>
              )}
              {detail.externalSignals?.map((sig, i) =>
                sig.provider === "skillmint" && sig.receiptVerified ? (
                  <SkillMintSignalBlock key={i} signal={sig} />
                ) : sig.provider === "skillmint" && !sig.receiptVerified ? (
                  <div key={i} className="border-t border-hairline pt-4">
                    <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
                      External Skill Signal — SkillMint
                    </div>
                    <p className="font-mono text-[11px] text-ink-dim">
                      SkillMint signal unavailable — receipt not verified.
                    </p>
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="font-mono text-[9px] uppercase tracking-kicker px-2 py-0.5 rounded-sm bg-amber/10 text-amber border border-amber/20">
                  TEE reasoning: not recovered
                </span>
              </div>
              <p className="font-mono text-[11px] text-ink-faint leading-relaxed">
                Signer, attestation, intent hash, response hash and vault log remain verifiable on-chain.
              </p>
              {detail?.txHash && (
                <a
                  href={`${EXPLORER}/tx/${detail.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-amber hover:underline flex items-center gap-1"
                >
                  View execution tx {detail.txHash.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <footer className="border-t border-hairline px-5 h-9 flex items-center justify-end">
        <a
          href={`${EXPLORER}/address/${vaultAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] uppercase tracking-kicker text-amber hover:text-ink transition-colors flex items-center gap-1.5"
        >
          View on explorer <ExternalLink className="h-3 w-3" />
        </a>
      </footer>
    </article>
  );
}

const REJECTION_TYPE_LABEL: Record<string, string> = {
  "defensive-override": "Verifier hold",
  "onchain-revert": "On-chain revert",
  "agent-sizing": "Agent sizing",
  "tee-signer-mismatch": "TEE signer mismatch",
  "audit-storage": "Audit storage",
};

const REJECTION_PHASE_LABEL: Record<string, string> = {
  "state-read": "State read",
  "estimateGas": "Estimate only",
  "executeStrategy": "Execute tx",
};

function RejectionRow({ entry }: { entry: VaultRejectionEntry }) {
  const date = new Date(entry.timestamp);
  const isVerifierHold = entry.type === "defensive-override";
  const safeVerdict =
    entry.verdict ??
    (entry.errorCode === "PriceStale"
      ? "Blocked safely: oracle price was stale. No funds moved."
      : entry.safeNoFundsMoved
        ? "Blocked safely: no funds moved."
      : isVerifierHold
        ? "Verifier hold: model disagreed with policy, so no trade was sent."
      : null);
  return (
    <div className="py-2.5 grid grid-cols-[auto_1fr_auto] gap-3 items-start">
      {isVerifierHold ? (
        <ShieldCheck className="h-3.5 w-3.5 text-amber mt-0.5 shrink-0" />
      ) : (
        <ShieldX className="h-3.5 w-3.5 text-alert mt-0.5 shrink-0" />
      )}
      <div>
        {safeVerdict && (
          <p className={`font-mono text-[11px] leading-snug mb-1 ${isVerifierHold ? "text-amber" : "text-phosphor"}`}>
            {safeVerdict}
          </p>
        )}
        <p className="font-mono text-[11px] text-ink leading-snug">
          {entry.reason}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-ink-dim">
          {entry.errorCode && (
            <code className="text-alert/80">{entry.errorCode}</code>
          )}
          {entry.phase && <span>phase: {REJECTION_PHASE_LABEL[entry.phase] ?? entry.phase}</span>}
          {entry.action && <span>action: {entry.action}</span>}
          {entry.priceAgeSec != null && entry.maxPriceStaleness != null && (
            <span>
              price age: {entry.priceAgeSec}s / max {entry.maxPriceStaleness}s
            </span>
          )}
          {entry.txHash ? (
            <a
              href={`${EXPLORER}/tx/${entry.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber hover:underline tabular flex items-center gap-1"
            >
              tx {entry.txHash.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span>no tx</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono text-[9px] text-ink-faint">
          {REJECTION_TYPE_LABEL[entry.type] ?? entry.type}
        </p>
        <p className="font-mono text-[9px] text-ink-faint">
          <span title={`${date.toISOString().slice(0, 19)} UTC`}>{date.toLocaleString([], { dateStyle: "short", timeStyle: "medium" })}</span>
        </p>
      </div>
    </div>
  );
}


function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
