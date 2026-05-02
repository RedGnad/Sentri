"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { toast } from "sonner";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import { galileo } from "@/config/wagmi";
import { shortenAddress } from "@/lib/utils";
import { LogOut, Copy, Check, ExternalLink, AlertTriangle } from "lucide-react";

export function ConnectButton() {
  const { address, isConnected, chainId: walletChainId, connector } = useAccount();
  const { data: balanceData } = useBalance({
    address,
    chainId: galileo.id,
    query: { enabled: !!address && walletChainId === galileo.id },
  });
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const [showConnect, setShowConnect] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!showAccount) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        buttonRef.current &&
        !buttonRef.current.contains(t)
      ) {
        setShowAccount(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAccount]);

  async function handleSwitchChain() {
    try {
      await switchChainAsync({ chainId: galileo.id });
      toast.success(`Switched to ${galileo.name}`);
    } catch (err: unknown) {
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum;
      if (eth) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${galileo.id.toString(16)}`,
                chainName: galileo.name,
                nativeCurrency: galileo.nativeCurrency,
                rpcUrls: [...galileo.rpcUrls.default.http],
                blockExplorerUrls: [galileo.blockExplorers.default.url],
              },
            ],
          });
          toast.success(`${galileo.name} added to wallet`);
          return;
        } catch (addErr: unknown) {
          const msg = addErr instanceof Error ? addErr.message : "Unknown error";
          toast.error("Failed to add network", { description: msg });
          return;
        }
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to switch network", { description: msg });
    }
  }

  function handleCopy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDisconnect() {
    disconnect();
    setShowAccount(false);
    toast.success("Wallet disconnected");
  }

  // ── Not connected ────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <>
        <Button size="sm" onClick={() => setShowConnect(true)}>
          Connect Wallet
        </Button>

        {showConnect && mounted && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-sunk/80 backdrop-blur-sm p-4"
            onClick={() => setShowConnect(false)}
          >
            <div
              className="bg-bg-elev border border-hairline-strong w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 h-11 border-b border-hairline">
                <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                  Select wallet
                </span>
                <button
                  onClick={() => setShowConnect(false)}
                  className="font-mono text-xs text-ink-dim hover:text-amber transition-colors"
                  aria-label="Close"
                >
                  [ esc ]
                </button>
              </div>
              <ul className="divide-y divide-hairline">
                {connectors.map((c) => (
                  <li key={c.uid}>
                    <button
                      onClick={() => {
                        connect({ connector: c });
                        setShowConnect(false);
                      }}
                      className="w-full flex items-center gap-4 px-5 h-14 hover:bg-bg-elev/40 transition-colors text-left group"
                    >
                      {c.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.icon} alt={c.name} className="w-6 h-6" />
                      ) : (
                        <div className="w-6 h-6 border border-hairline-strong" />
                      )}
                      <span className="font-mono text-[11px] uppercase tracking-kicker text-ink flex-1 group-hover:text-amber transition-colors">
                        {c.name}
                      </span>
                      <span className="font-mono text-[10px] text-ink-faint group-hover:text-amber transition-colors">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  // ── Connected ────────────────────────────────────────────────────────
  const wrongNetwork = walletChainId !== galileo.id;
  const balanceFormatted = balanceData
    ? `${Number(formatUnits(balanceData.value, balanceData.decimals)).toFixed(3)} ${balanceData.symbol}`
    : "—";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setShowAccount(!showAccount)}
        className={`flex items-center gap-2 h-10 px-3 border font-mono text-[10px] uppercase tracking-kicker transition-colors ${
          wrongNetwork
            ? "border-alert/50 text-alert hover:bg-alert/5"
            : "border-hairline-strong text-ink hover:border-amber hover:text-amber"
        }`}
      >
        <span
          className={`inline-block w-1.5 h-1.5 ${
            wrongNetwork ? "bg-alert" : "bg-phosphor animate-pulse-dot"
          }`}
        />
        {wrongNetwork ? (
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            Wrong net
          </span>
        ) : (
          <span>{shortenAddress(address!)}</span>
        )}
      </button>

      {showAccount && (
        <div
          ref={popoverRef}
          className="absolute right-0 mt-2 w-80 bg-bg-elev border border-hairline-strong z-[100]"
        >
          <div className="px-5 h-11 flex items-center justify-between border-b border-hairline">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
              Account
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-kicker">
              <span
                className={`inline-block w-1.5 h-1.5 ${
                  wrongNetwork ? "bg-alert" : "bg-phosphor animate-pulse-dot"
                }`}
              />
              <span className={wrongNetwork ? "text-alert" : "text-phosphor"}>
                {wrongNetwork ? "Offline" : "Online"}
              </span>
            </span>
          </div>

          <div className="px-5 py-4 border-b border-hairline">
            <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
              Address
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[13px] text-ink tabular">{shortenAddress(address!)}</span>
              <button
                onClick={handleCopy}
                className="text-ink-faint hover:text-amber transition-colors"
                aria-label="Copy address"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-phosphor" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {wrongNetwork && (
            <div className="px-5 py-4 border-b border-hairline">
              <p className="font-mono text-[10px] text-alert leading-relaxed mb-3">
                Wallet on chain {walletChainId}. Sentri requires {galileo.name} ({galileo.id}).
              </p>
              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                onClick={handleSwitchChain}
                disabled={isSwitching}
              >
                {isSwitching ? "Switching..." : `Switch → ${galileo.name}`}
              </Button>
            </div>
          )}

          <div className="px-5 py-3 border-b border-hairline space-y-2">
            <Row label="Wallet" value={connector?.name ?? "—"} />
            <Row
              label="Network"
              value={wrongNetwork ? `Chain ${walletChainId}` : `${galileo.name} ${galileo.id}`}
              valueClass={wrongNetwork ? "text-alert" : "text-ink"}
            />
            <Row label="Balance" value={balanceFormatted} />
          </div>

          <div className="divide-y divide-hairline">
            {!wrongNetwork && (
              <a
                href={`${galileo.blockExplorers.default.url}/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-between px-5 h-11 font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber hover:bg-bg-elev/60 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on explorer
                </span>
                <span>→</span>
              </a>
            )}
            <button
              onClick={handleDisconnect}
              className="w-full flex items-center justify-between px-5 h-11 font-mono text-[10px] uppercase tracking-kicker text-alert hover:bg-alert/5 transition-colors"
            >
              <span className="flex items-center gap-2">
                <LogOut className="h-3.5 w-3.5" />
                Disconnect
              </span>
              <span>×</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  valueClass = "text-ink",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
        {label}
      </span>
      <span className={`font-mono text-[11px] ${valueClass}`}>{value}</span>
    </div>
  );
}
