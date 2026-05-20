"use client";

import { useState } from "react";
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
import { ChevronDown, ChevronUp, ExternalLink, ShieldX } from "lucide-react";
import { galileo } from "@/config/wagmi";

const ACTION_LABELS = [
  "Rebalance",
  "YieldFarm",
  "EmergencyDeleverage",
] as const;
const ACTION_VARIANTS = ["default", "success", "destructive"] as const;
const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? galileo.blockExplorers.default.url;

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
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-kicker text-alert">
              <ShieldX className="h-3.5 w-3.5" />
              {visibleRejections.length} blocked action
              {visibleRejections.length === 1 ? "" : "s"}
            </span>
            {rejectionsExpanded ? (
              <ChevronUp className="h-4 w-4 text-ink-dim" />
            ) : (
              <ChevronDown className="h-4 w-4 text-ink-dim" />
            )}
          </button>
          {rejectionsExpanded && (
            <div className="border-t border-hairline px-4 pb-3 divide-y divide-hairline">
              {visibleRejections.map((r, i) => (
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
  const {
    data: detail,
    isLoading: detailLoading,
    isFetching: detailFetching,
  } = useVaultAuditDetail(
    expanded ? vaultAddress : undefined,
    expanded ? tsMs : null,
  );

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
          <Badge variant={variant as "default" | "success" | "destructive"}>
            {actionLabel}
          </Badge>
        </div>
        <span className="font-mono text-[10px] text-ink-faint tabular">
          {date.toISOString().slice(0, 19).replace("T", " ")} UTC
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
        <code className="font-mono text-[11px] text-ink-dim break-all">
          {new Date(Number(deadline) * 1000)
            .toISOString()
            .slice(0, 19)
            .replace("T", " ")}{" "}
          UTC
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
          {detailLoading || (detailFetching && !detail?.reasoning) ? (
            <p className="font-mono text-[11px] text-ink-faint">
              Loading from agent server...
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
                  <span className="font-mono text-[11px] text-ink-dim tabular">
                    {detail.provider
                      ? `${detail.provider.slice(0, 10)}...`
                      : "-"}
                  </span>
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
                  <code className="font-mono text-[11px] text-ink-dim break-all">
                    {detail.chatID || "-"}
                  </code>
                </Field>
                <Field label="Recovered signer">
                  <code className="font-mono text-[11px] text-ink-dim break-all">
                    {detail.recoveredSigner
                      ? `${detail.recoveredSigner.slice(0, 10)}...`
                      : "-"}
                  </code>
                </Field>
                <Field label="Signed payload hash">
                  <code className="font-mono text-[11px] text-ink-dim break-all">
                    {detail.signedPayloadHash
                      ? `${detail.signedPayloadHash.slice(0, 18)}...`
                      : "-"}
                  </code>
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
                {detail.txHash && (
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
                )}
                {detail.canonicalStorageTxHash && (
                  <Field label="Canonical blob TX">
                    <a
                      href={`${EXPLORER}/tx/${detail.canonicalStorageTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-amber hover:underline tabular flex items-center gap-1"
                    >
                      {detail.canonicalStorageTxHash.slice(0, 10)}…{" "}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Field>
                )}
                {detail.canonicalRootHash && (
                  <Field label="Canonical root">
                    <code className="font-mono text-[11px] text-ink-dim break-all">
                      {detail.canonicalRootHash.slice(0, 18)}...
                    </code>
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
                    <code className="font-mono text-[11px] text-ink-dim break-all">
                      {detail.kvIndexRootHash.slice(0, 18)}...
                    </code>
                  </Field>
                )}
                {detail.canonicalRecordHash && (
                  <Field label="Record hash">
                    <code className="font-mono text-[11px] text-ink-dim break-all">
                      {detail.canonicalRecordHash.slice(0, 18)}...
                    </code>
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
            </div>
          ) : (
            <p className="font-mono text-[11px] text-ink-faint leading-relaxed">
              On-chain proof verified. Enriched TEE reasoning is not currently
              indexed by the agent cache, but the vault log, hashes, signer, and
              attestation remain verifiable on-chain.
            </p>
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
  "defensive-override": "Defensive override",
  "onchain-revert": "On-chain revert",
  "agent-sizing": "Agent sizing",
};

function RejectionRow({ entry }: { entry: VaultRejectionEntry }) {
  const date = new Date(entry.timestamp);
  return (
    <div className="py-2.5 grid grid-cols-[auto_1fr_auto] gap-3 items-start">
      <ShieldX className="h-3.5 w-3.5 text-alert mt-0.5 shrink-0" />
      <div>
        <p className="font-mono text-[11px] text-ink leading-snug">
          {entry.reason}
        </p>
        {entry.errorCode && (
          <code className="font-mono text-[10px] text-alert/80">
            {entry.errorCode}
          </code>
        )}
        {entry.action && (
          <span className="ml-2 font-mono text-[10px] text-ink-dim">
            action: {entry.action}
          </span>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono text-[9px] text-ink-faint">
          {REJECTION_TYPE_LABEL[entry.type] ?? entry.type}
        </p>
        <p className="font-mono text-[9px] text-ink-faint">
          {date.toLocaleTimeString()}
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
