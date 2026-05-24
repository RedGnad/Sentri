"use client";

// Local preview page for the SkillMintSignalBlock UI component.
// Uses the real execute-once receipt from 2026-05-24 (skill #13, standalone test).
// This is NOT a vault execution — it is a standalone skill call with no vault tx.
// Route is not linked from the main UI; access at /skillmint-preview.

import { SkillMintSignalBlock } from "@/components/skillmint-signal-block";
import type { ExternalSignal } from "@/hooks/use-vault-runtime";

// Real data from execute-once run against skill #13 on 2026-05-24.
// Settlement tx: 0xf4194f99c7d30ae876b09d8c613fa2985dda36133d8f95bcd2a23136a2ae74ab
// Caller: 0xaE8fB2c842cF7b0260a9857CAA2B6Cd31B14B807 (dedicated low-balance wallet)
// This was a standalone test — no Sentri vault tx was sent.
const EXECUTE_ONCE_SIGNAL: ExternalSignal = {
  provider: "skillmint",
  skillId: "13",
  action: "EmergencyDeleverage",
  amountBps: 3000,
  confidence: 72,
  reason:
    "The request lacks policy, oracle freshness, exposure, and drawdown context, so the conservative advisory is to deleverage rather than approve a rebalance.",
  receiptVerified: true,
  receiptRootHash: "0x3431c5214bcc510b37ed99d51c1ddbd09edea0f316fdce8e26f5cf0fdba86140",
  receiptStorageScanUrl:
    "https://storagescan.0g.ai/file/0x3431c5214bcc510b37ed99d51c1ddbd09edea0f316fdce8e26f5cf0fdba86140",
  receiptVerification: {
    valid: true,
    inputHashOk: true,
    outputHashOk: true,
    teeVerified: true,
  },
  callTs: 1779617800229,
  // No relation — this was a standalone test, not part of a live vault cycle.
};

export default function SkillMintPreviewPage() {
  return (
    <div className="min-h-screen bg-bg px-6 py-12 max-w-2xl mx-auto space-y-8">
      <div className="border border-amber/30 bg-amber/5 px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-kicker text-amber mb-1">
          Preview — standalone skill test receipt
        </p>
        <p className="font-mono text-[11px] text-ink-dim">
          This is a standalone execute-once receipt from 2026-05-24. No Sentri
          vault tx was sent. This page is for UI preview only — not linked from
          production.
        </p>
      </div>

      <div>
        <h1 className="font-serif text-2xl text-ink mb-1">
          SkillMint Signal Block Preview
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
          Skill #13 · Sentri Treasury Signal · 0G Aristotle Mainnet
        </p>
      </div>

      {/* The component exactly as it appears inside an audit entry */}
      <div className="border border-hairline bg-bg-elev/20 px-5 py-5">
        <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-4">
          This block appears below the TEE reasoning when a live candidate action
          triggers a SkillMint call
        </div>
        <SkillMintSignalBlock signal={EXECUTE_ONCE_SIGNAL} />
      </div>

      <div className="border border-hairline px-4 py-3 space-y-1">
        <p className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
          Receipt provenance
        </p>
        <p className="font-mono text-[11px] text-ink-dim break-all">
          Settlement tx:{" "}
          <a
            href="https://chainscan-galileo.0g.ai/tx/0xf4194f99c7d30ae876b09d8c613fa2985dda36133d8f95bcd2a23136a2ae74ab"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber hover:underline"
          >
            0xf4194f99…74ab
          </a>
        </p>
        <p className="font-mono text-[11px] text-ink-dim break-all">
          Caller wallet: 0xaE8fB2c842cF7b0260a9857CAA2B6Cd31B14B807
        </p>
        <p className="font-mono text-[11px] text-ink-dim break-all">
          Input: Rebalance 3000bps, vault 0x3C11…C982 (test input — no real
          vault context)
        </p>
      </div>
    </div>
  );
}
