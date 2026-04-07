"use client";

import Link from "next/link";
import { ConnectButton } from "@/components/connect-button";
import { Shield, Lock, Eye, Zap, AlertTriangle, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Lock,
    title: "Private Strategy",
    description: "Plans analyzed inside TEE via Sealed Inference. Your strategy never leaves the enclave.",
  },
  {
    icon: Eye,
    title: "Verifiable Results",
    description: "Every decision published with cryptographic proof and TEE attestation on-chain.",
  },
  {
    icon: Zap,
    title: "Autonomous Execution",
    description: "Agent loop runs continuously: analyze, decide, execute, log. No manual intervention.",
  },
  {
    icon: AlertTriangle,
    title: "Kill-Switch",
    description: "Emergency withdraw pulls all funds instantly. Pause/unpause for temporary circuit breaking.",
  },
  {
    icon: Database,
    title: "Immutable Audit Trail",
    description: "Full history stored on 0G Storage Log. Every decision traceable and tamper-proof.",
  },
  {
    icon: Shield,
    title: "Policy Engine",
    description: "On-chain risk policies: max allocation, max drawdown, cooldown periods. Agent cannot override.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <div className="text-center max-w-3xl mx-auto pt-16 pb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-6">
          <Shield className="h-4 w-4" />
          Built on 0G
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6">
          Your AI Treasurer
        </h1>
        <p className="text-xl text-white/60 mb-4">
          Private strategy, verifiable results.
        </p>
        <p className="text-white/40 mb-10 max-w-xl mx-auto">
          Sentri is an autonomous stablecoin treasury agent. It plans privately
          inside a TEE via Sealed Inference, executes according to on-chain risk
          policies, and publishes verifiable proofs without revealing strategy.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/vault">
            <Button size="lg">Open Dashboard</Button>
          </Link>
          <ConnectButton />
        </div>
      </div>

      {/* Features */}
      <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
        {FEATURES.map((feature) => (
          <Card key={feature.title}>
            <CardContent className="pt-6">
              <feature.icon className="h-8 w-8 text-emerald-400 mb-4" />
              <h3 className="font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-white/60">{feature.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Architecture */}
      <div className="w-full pb-20">
        <h2 className="text-2xl font-bold text-center mb-8">Agent Loop</h2>
        <div className="flex flex-wrap justify-center gap-3 text-sm">
          {[
            "Deposit",
            "Fetch Market Data",
            "Sealed Inference (TEE)",
            "Policy Check",
            "Execute On-Chain",
            "Verifiable Proof",
            "Audit Trail (0G Storage)",
            "Kill-Switch Ready",
          ].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                {i + 1}
              </span>
              <span className="text-white/80">{step}</span>
              {i < 7 && <span className="text-white/20 ml-1">&rarr;</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 0G Components */}
      <div className="w-full pb-20">
        <h2 className="text-2xl font-bold text-center mb-8">0G Components Used</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { name: "Chain", desc: "TreasuryVault on Galileo" },
            { name: "Sealed Inference", desc: "Private strategy in TEE" },
            { name: "Storage KV", desc: "Portfolio state snapshots" },
            { name: "Storage Log", desc: "Immutable audit trail" },
            { name: "Agent ID", desc: "On-chain agent identity" },
          ].map((comp) => (
            <Card key={comp.name} className="text-center">
              <CardContent className="pt-6">
                <p className="font-semibold text-emerald-400">{comp.name}</p>
                <p className="text-xs text-white/50 mt-1">{comp.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
