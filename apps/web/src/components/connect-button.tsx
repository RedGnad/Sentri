"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useReadContract,
} from "wagmi";
import { usePrivy, useLoginWithEmail, useConnectWallet, useLoginWithOAuth, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { toast } from "sonner";
import { formatUnits, erc20Abi } from "viem";
import { Button } from "@/components/ui/button";
import { galileo } from "@/config/wagmi";
import { shortenAddress } from "@/lib/utils";
import { BASE_SYMBOL, BASE_TOKEN_ADDRESS } from "@/config/contracts";
import { LogOut, Copy, Check, ExternalLink, AlertTriangle } from "lucide-react";

// Privy is the active path when an App ID is configured (email/social sign-in +
// embedded wallet + smart account). Otherwise we render the original wallet-only
// button so the injected / WalletConnect flow keeps working unchanged.
const PRIVY_ENABLED = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function ConnectButton() {
  return PRIVY_ENABLED ? <PrivyConnectButton /> : <WalletConnectButton />;
}

// ── Privy path ──────────────────────────────────────────────────────────────
function PrivyConnectButton() {
  const { ready, authenticated, logout } = usePrivy();

  if (!ready) {
    return (
      <Button size="sm" disabled>
        Sign in
      </Button>
    );
  }
  if (!authenticated) {
    return <PrivySignIn />;
  }
  return <PrivyConnected onDisconnect={() => logout()} />;
}

// Sign-in entry: opens a custom (headless) login modal in our own visual style.
function PrivySignIn() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Sign in
      </Button>
      {open && mounted && createPortal(<LoginModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

// Fully custom login UI (Privy headless): email OTP + connect wallet. Keeps our
// own modal look instead of Privy's default modal.
function LoginModal({ onClose }: { onClose: () => void }) {
  const { state, sendCode, loginWithCode } = useLoginWithEmail();
  const { connectWallet } = useConnectWallet();
  const { initOAuth } = useLoginWithOAuth();
  const { authenticated } = usePrivy();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  // Close once the user is authenticated (email OTP, OAuth, or wallet connect).
  useEffect(() => {
    if (authenticated) onClose();
  }, [authenticated, onClose]);

  const status = state.status;
  const sending = status === "sending-code";
  // Only show the code step when an email is actually on file. Privy's hook
  // state persists across remounts, so without this guard reopening the modal
  // mid-flow shows a stuck "Enter the code sent to ." with no way back.
  const showCode = (status === "awaiting-code-input" || status === "submitting-code") && !!email;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-sunk/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-elev border border-hairline-strong w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-11 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
            Sign in to Sentri
          </span>
          <button
            onClick={onClose}
            className="font-mono text-xs text-ink-dim hover:text-amber transition-colors"
            aria-label="Close"
          >
            [ esc ]
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {!showCode ? (
            <>
              <label className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                placeholder="you@email.com"
                className="w-full bg-bg border border-hairline px-3 h-10 text-[13px] text-ink outline-none focus:border-amber transition-colors"
              />
              <Button
                className="w-full"
                onClick={() => sendCode({ email })}
                disabled={sending || !email.includes("@")}
              >
                {sending ? "Sending code…" : "Continue with email →"}
              </Button>
            </>
          ) : (
            <>
              <p className="font-mono text-[10px] text-ink-dim leading-relaxed">
                Enter the code sent to <span className="text-ink">{email}</span>.
              </p>
              <input
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                placeholder="123456"
                className="w-full bg-bg border border-hairline px-3 h-10 text-[15px] tabular tracking-widest text-ink outline-none focus:border-amber transition-colors"
              />
              <Button
                className="w-full"
                onClick={() => loginWithCode({ code })}
                disabled={status === "submitting-code" || code.length < 6}
              >
                {status === "submitting-code" ? "Verifying…" : "Verify & sign in ∎"}
              </Button>
              <button
                onClick={() => { setEmail(""); setCode(""); }}
                className="w-full font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors"
              >
                ← Use a different email
              </button>
            </>
          )}

          {status === "error" && (
            <p className="font-mono text-[10px] text-alert">Something went wrong. Try again.</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <span className="h-px flex-1 bg-hairline" />
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">or</span>
            <span className="h-px flex-1 bg-hairline" />
          </div>

          <Button variant="outline" className="w-full" onClick={() => initOAuth({ provider: "google" })}>
            Continue with Google
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => initOAuth({ provider: "discord" })}>
              Discord
            </Button>
            <Button variant="outline" onClick={() => initOAuth({ provider: "twitter" })}>
              Twitter
            </Button>
          </div>
          <Button variant="outline" className="w-full" onClick={() => connectWallet()}>
            Connect a wallet
          </Button>
        </div>
      </div>
    </div>
  );
}

// Connected view for Privy: surfaces the SMART ACCOUNT (where funds live + what
// sends gasless tx) prominently, plus the signer EOA and a logout.
function PrivyConnected({ onDisconnect }: { onDisconnect: () => void }) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { client } = useSmartWallets();
  const smart = client?.account?.address as `0x${string}` | undefined;
  // The Privy embedded wallet (the signer) — NOT wagmi's useAccount, which can
  // surface a leftover injected browser wallet and show the wrong address for an
  // email user.
  const embedded = (wallets.find((w) => w.walletClientType === "privy")?.address ??
    user?.wallet?.address) as `0x${string}` | undefined;

  const { data: usdce } = useReadContract({
    address: BASE_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: smart ? [smart] : undefined,
    chainId: galileo.id,
    query: { enabled: !!smart, refetchInterval: 10_000 },
  });

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"smart" | "eoa" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(t) &&
        buttonRef.current && !buttonRef.current.contains(t)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function copy(value: string, which: "smart" | "eoa") {
    navigator.clipboard.writeText(value);
    setCopied(which);
    toast.success("Address copied");
    setTimeout(() => setCopied(null), 1500);
  }

  const usdceFormatted =
    usdce !== undefined ? `${Number(formatUnits(usdce as bigint, 6)).toFixed(2)} ${BASE_SYMBOL}` : "—";

  // Prefer the smart account (gasless); fall back to the signer EOA when no
  // smart wallet is provisioned (e.g. an external wallet was linked instead of
  // an email sign-in). Avoids being stuck on a "Finishing…" placeholder.
  const account = (smart ?? embedded) as `0x${string}` | undefined;
  const label = account ? shortenAddress(account) : "…";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-10 px-3 border border-hairline-strong text-ink hover:border-amber hover:text-amber font-mono text-[10px] uppercase tracking-kicker transition-colors"
      >
        <span className="inline-block w-1.5 h-1.5 bg-phosphor animate-pulse-dot" />
        <span>{label}</span>
      </button>

      {open && (
        <div ref={popoverRef} className="absolute right-0 mt-2 w-80 bg-bg-elev border border-hairline-strong z-[100]">
          <div className="px-5 h-11 flex items-center justify-between border-b border-hairline">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">Account</span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-kicker">
              <span className="inline-block w-1.5 h-1.5 bg-phosphor animate-pulse-dot" />
              <span className="text-phosphor">{smart ? "Online · gasless" : "Online"}</span>
            </span>
          </div>

          {smart ? (
            <>
              <div className="px-5 py-4 border-b border-hairline">
                <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
                  Smart account (fund this)
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] text-ink tabular">{shortenAddress(smart)}</span>
                  <button onClick={() => copy(smart, "smart")} className="text-ink-faint hover:text-amber transition-colors" aria-label="Copy smart account">
                    {copied === "smart" ? <Check className="h-3.5 w-3.5 text-phosphor" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="font-mono text-[10px] text-ink-dim tabular mt-1">Balance: {usdceFormatted}</div>
              </div>
              <div className="px-5 py-3 border-b border-hairline">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">Signer</span>
                  <span className="font-mono text-[10px] text-ink-dim tabular">{embedded ? shortenAddress(embedded) : "—"}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="px-5 py-4 border-b border-hairline">
              <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">Wallet</div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] text-ink tabular">{embedded ? shortenAddress(embedded) : "…"}</span>
                {embedded && (
                  <button onClick={() => copy(embedded, "eoa")} className="text-ink-faint hover:text-amber transition-colors" aria-label="Copy address">
                    {copied === "eoa" ? <Check className="h-3.5 w-3.5 text-phosphor" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="divide-y divide-hairline">
            {account && (
              <a
                href={`${galileo.blockExplorers.default.url}/address/${account}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-between px-5 h-11 font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber hover:bg-bg-elev/60 transition-colors"
              >
                <span className="flex items-center gap-2"><ExternalLink className="h-3.5 w-3.5" />View on explorer</span>
                <span>→</span>
              </a>
            )}
            <button
              onClick={() => { onDisconnect(); setOpen(false); toast.success("Signed out"); }}
              className="w-full flex items-center justify-between px-5 h-11 font-mono text-[10px] uppercase tracking-kicker text-alert hover:bg-alert/5 transition-colors"
            >
              <span className="flex items-center gap-2"><LogOut className="h-3.5 w-3.5" />Sign out</span>
              <span>×</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wallet-only path (fallback): injected / WalletConnect ───────────────────
function WalletConnectButton() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [showConnect, setShowConnect] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (isConnected) {
    return <ConnectedAccount onDisconnect={() => disconnect()} />;
  }

  return (
    <>
      <Button size="sm" onClick={() => setShowConnect(true)}>
        Connect Wallet
      </Button>

      {showConnect &&
        mounted &&
        createPortal(
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
                      ) : null}
                      <span className="font-mono text-[11px] uppercase tracking-kicker text-ink flex-1 group-hover:text-amber transition-colors">
                        {c.name === "Injected" ? "Browser wallet" : c.name}
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
          document.body,
        )}
    </>
  );
}

// ── Shared connected-account popover (wallet-only path) ──────────────────────
function ConnectedAccount({ onDisconnect }: { onDisconnect: () => void }) {
  const { address, chainId: walletChainId, connector } = useAccount();
  const { data: balanceData } = useBalance({
    address,
    chainId: galileo.id,
    query: { enabled: !!address && walletChainId === galileo.id },
  });
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const [showAccount, setShowAccount] = useState(false);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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
      const eth = (
        window as unknown as {
          ethereum?: {
            request: (a: {
              method: string;
              params: unknown[];
            }) => Promise<unknown>;
          };
        }
      ).ethereum;
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
    onDisconnect();
    setShowAccount(false);
    toast.success("Wallet disconnected");
  }

  const wrongNetwork = walletChainId !== galileo.id;
  const balanceFormatted = balanceData
    ? `${Number(formatUnits(balanceData.value, balanceData.decimals)).toFixed(3)} ${balanceData.symbol}`
    : "—";
  const gasEmpty =
    !wrongNetwork && balanceData !== undefined && balanceData.value === 0n;

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
                {wrongNetwork ? "Wrong network" : "Online"}
              </span>
            </span>
          </div>

          <div className="px-5 py-4 border-b border-hairline">
            <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
              Address
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[13px] text-ink tabular">
                {shortenAddress(address!)}
              </span>
              <button
                onClick={handleCopy}
                className="text-ink-faint hover:text-amber transition-colors"
                aria-label="Copy address"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-phosphor" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {wrongNetwork && (
            <div className="px-5 py-4 border-b border-hairline">
              <p className="font-mono text-[10px] text-alert leading-relaxed mb-3">
                Wallet on chain {walletChainId}. Sentri requires {galileo.name}{" "}
                ({galileo.id}).
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
              value={
                wrongNetwork
                  ? `Chain ${walletChainId}`
                  : `${galileo.name} ${galileo.id}`
              }
              valueClass={wrongNetwork ? "text-alert" : "text-ink"}
            />
            <Row
              label="Balance"
              value={balanceFormatted}
              valueClass={gasEmpty ? "text-amber" : "text-ink"}
            />
            {gasEmpty && (
              <p className="font-mono text-[9px] uppercase tracking-kicker text-amber pt-1">
                Top up {balanceData?.symbol ?? "0G"} for gas before any TX.
              </p>
            )}
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
