"use client";

import { useState, useRef, useEffect } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { galileo } from "@/config/wagmi";
import { shortenAddress } from "@/lib/utils";
import { Wallet, LogOut, ChevronDown } from "lucide-react";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [showModal, setShowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Not connected → show connect modal
  if (!isConnected) {
    return (
      <>
        <Button size="sm" onClick={() => setShowModal(true)}>
          <Wallet className="h-4 w-4 mr-2" />
          Connect Wallet
        </Button>

        {showModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <div
              className="bg-[#1a1b1f] border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6 shrink-0">
                <h2 className="text-lg font-semibold">Connect Wallet</h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-white/40 hover:text-white transition-colors text-xl leading-none"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-2 overflow-y-auto">
                {connectors.map((connector) => (
                  <button
                    key={connector.uid}
                    onClick={() => {
                      connect({ connector });
                      setShowModal(false);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all text-left"
                  >
                    {connector.icon ? (
                      <img
                        src={connector.icon}
                        alt={connector.name}
                        className="w-8 h-8 rounded-lg"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                        <Wallet className="h-4 w-4 text-emerald-400" />
                      </div>
                    )}
                    <span className="font-medium">{connector.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Wrong network → switch
  if (chainId !== galileo.id) {
    return (
      <Button
        size="sm"
        variant="destructive"
        onClick={() => switchChain({ chainId: galileo.id })}
      >
        Switch to Galileo
      </Button>
    );
  }

  // Connected → show address + dropdown
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="font-mono text-white/80">{shortenAddress(address!)}</span>
        <ChevronDown className="h-3 w-3 text-white/40" />
      </button>

      {showMenu && (
        <div className="absolute right-0 mt-2 w-48 bg-[#1a1b1f] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-white/5">
            <p className="text-xs text-white/40">Connected to</p>
            <p className="text-sm font-mono text-white/80">{shortenAddress(address!)}</p>
          </div>
          <button
            onClick={() => {
              disconnect();
              setShowMenu(false);
            }}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-white/5 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
