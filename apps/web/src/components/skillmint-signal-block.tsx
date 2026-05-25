"use client";

import { useState } from "react";
import { ExternalLink, Check, Copy } from "lucide-react";
import type { ExternalSignal } from "@/hooks/use-vault-runtime";

const RELATION_LABEL: Record<string, string> = {
  agrees: "Agrees with Sentri",
  disagrees: "Disagrees with Sentri",
  capped_by_sentri: "Capped by Sentri policy",
  rejected_by_policy: "Rejected by Sentri policy",
  ignored: "Not applied",
};

const RELATION_COLOR: Record<string, string> = {
  agrees: "text-phosphor",
  disagrees: "text-alert",
  capped_by_sentri: "text-amber",
  rejected_by_policy: "text-alert",
  ignored: "text-ink-dim",
};

function CopyableHash({ value, slice = 18 }: { value: string; slice?: number }) {
  const [copied, setCopied] = useState(false);
  const display =
    value.length > slice + 4 ? `${value.slice(0, slice)}…${value.slice(-4)}` : value;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function SkillMintSignalBlock({ signal }: { signal: ExternalSignal }) {
  const relationLabel = signal.relation
    ? (RELATION_LABEL[signal.relation] ?? signal.relation)
    : "—";
  const relationColor = signal.relation
    ? (RELATION_COLOR[signal.relation] ?? "text-ink-dim")
    : "text-ink-dim";

  return (
    <div className="border-t border-hairline pt-4">
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-3">
        External Skill Signal —{" "}
        <span className="text-orchid">{signal.provider === "skillmint" ? "SkillMint" : signal.provider}</span>
      </div>
      <div className="border border-hairline bg-bg-sunk/30 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">
            Skill #{signal.skillId ?? "—"}
          </span>
          <span
            className={`font-mono text-[10px] uppercase tracking-kicker ${
              signal.receiptVerified ? "text-phosphor" : "text-alert/80"
            }`}
          >
            {signal.receiptVerified ? "Receipt verified" : "Receipt unverified"}
          </span>
        </div>
        {signal.receiptVerification && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(
              [
                ["valid", signal.receiptVerification.valid],
                ["inputHashOk", signal.receiptVerification.inputHashOk],
                ["outputHashOk", signal.receiptVerification.outputHashOk],
                ["teeVerified", signal.receiptVerification.teeVerified],
              ] as [string, boolean][]
            ).map(([key, ok]) => (
              <div key={key}>
                <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
                  {key}
                </div>
                <span className={`font-mono text-[11px] ${ok ? "text-phosphor" : "text-alert"}`}>
                  {ok ? "true" : "false"}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Recommendation">
            <span className="font-mono text-[12px] text-ink tabular">
              {signal.action}{" "}
              {signal.amountBps > 0 ? `${signal.amountBps}bps` : ""}
            </span>
          </Field>
          <Field label="Confidence">
            <span className="font-mono text-[12px] text-amber tabular">
              {signal.confidence}%
            </span>
          </Field>
          <Field label="Relation">
            <span className={`font-mono text-[12px] tabular ${relationColor}`}>
              {relationLabel}
            </span>
          </Field>
        </div>
        {signal.reason && (
          <Field label="Reason">
            <p className="font-mono text-[11px] text-ink-dim leading-relaxed">
              {signal.reason}
            </p>
          </Field>
        )}
        {signal.receiptRootHash && (
          <Field label="Receipt root">
            {signal.receiptStorageScanUrl ? (
              <a
                href={signal.receiptStorageScanUrl.replace("/file/", "/submission/")}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-amber hover:underline flex items-center gap-1"
              >
                {signal.receiptRootHash.slice(0, 18)}…
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <CopyableHash value={signal.receiptRootHash} />
            )}
          </Field>
        )}
        <p className="font-mono text-[10px] text-ink-faint border-t border-hairline pt-3">
          Advisory only — Sentri vault policy remains final.
        </p>
      </div>
    </div>
  );
}
