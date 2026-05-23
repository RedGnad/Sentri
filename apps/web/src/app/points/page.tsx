"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Activity, Medal, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface PointsStats {
  ok: boolean;
  path: string | null;
  writable: boolean;
  entries: number;
  lastError: string | null;
}

interface LeaderboardEntry {
  wallet: string;
  points: number;
  events: number;
}

interface PointEvent {
  id: string;
  uniqueKey: string;
  wallet: string;
  vaultAddress?: string;
  type: string;
  points: number;
  reason: string;
  txHash?: string;
  logIndex?: number;
  createdAt: number;
}

interface WalletPoints {
  wallet: string;
  total: number;
  entries: PointEvent[];
}

const PUBLIC_RULES = [
  { type: "active_vault_hour", label: "Active vault hour", points: 100 },
  { type: "safe_blocked_action", label: "Safe blocked action", points: 1_500 },
  { type: "useful_feedback", label: "Useful feedback", points: 2_500 },
  { type: "shipped_bug_report", label: "Shipped bug report", points: 5_000 },
];

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatEventType(type: string): string | null {
  if (type === "exceptional_bonus") return null;
  return type.replace(/_/g, " ");
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return "Pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export default function PointsPage() {
  const [stats, setStats] = useState<PointsStats | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [recent, setRecent] = useState<PointEvent[]>([]);
  const [walletInput, setWalletInput] = useState("");
  const [walletResult, setWalletResult] = useState<WalletPoints | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletLoading, setWalletLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [statsResult, leadersResult, recentResult] = await Promise.all([
          fetchJson<PointsStats>("/api/points/stats"),
          fetchJson<{ entries: LeaderboardEntry[] }>("/api/points/leaderboard?limit=25"),
          fetchJson<{ entries: PointEvent[] }>("/api/points/recent?limit=12"),
        ]);
        if (cancelled) return;
        setStats(statsResult);
        setLeaders(leadersResult.entries ?? []);
        setRecent(recentResult.entries ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const topTotal = useMemo(
    () => leaders.reduce((sum, row) => sum + row.points, 0),
    [leaders],
  );

  async function lookupWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wallet = walletInput.trim();
    if (!wallet) return;
    setWalletLoading(true);
    setError(null);
    try {
      setWalletResult(await fetchJson<WalletPoints>(`/api/points/${encodeURIComponent(wallet)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWalletLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        num="04"
        section="Points"
        title="Early Vault Points"
        subtitle="Experimental early tester score · no token · no financial claim"
      />

      {error && (
        <div className="border border-alert/40 bg-alert/5 px-4 py-3 font-mono text-xs text-alert">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Ledger"
          value={stats?.ok ? "Online" : "Pending"}
          detail={stats?.ok ? `${formatPoints(stats.entries)} events` : stats?.lastError ?? "Loading"}
        />
        <MetricCard
          label="Leaderboard"
          value={loading ? "..." : String(leaders.length)}
          detail={`${formatPoints(topTotal)} points indexed`}
        />
        <MetricCard
          label="Recent"
          value={loading ? "..." : String(recent.length)}
          detail="Latest ledger events"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] items-start gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Leaderboard</CardTitle>
            <Badge variant={stats?.ok ? "success" : "warning"}>
              {stats?.ok ? "Live ledger" : "Unavailable"}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {leaders.length === 0 ? (
              <EmptyState text={loading ? "Loading points ledger..." : "No points recorded yet."} />
            ) : (
              <div className="divide-y divide-hairline">
                {leaders.map((row, index) => (
                  <div
                    key={row.wallet}
                    className="grid grid-cols-[48px_minmax(0,1fr)_120px] items-center gap-3 px-5 py-4"
                  >
                    <div className="font-mono text-xs text-ink-faint">
                      #{index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-ink truncate">{row.wallet}</div>
                      <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                        {row.events} event{row.events === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="text-right font-serif text-2xl text-amber">
                      {formatPoints(row.points)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Wallet Lookup</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={lookupWallet} className="flex gap-2">
                <Input
                  value={walletInput}
                  onChange={(event) => setWalletInput(event.target.value)}
                  placeholder="0x..."
                  className="font-mono text-xs"
                />
                <Button type="submit" size="icon" disabled={walletLoading} aria-label="Search wallet">
                  <Search className="h-4 w-4" />
                </Button>
              </form>
              {walletResult && (
                <div className="mt-5 border-t border-hairline pt-4">
                  <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                    {shortAddress(walletResult.wallet)}
                  </div>
                  <div className="mt-1 font-serif text-4xl text-ink">
                    {formatPoints(walletResult.total)}
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                    {walletResult.entries.length} event{walletResult.entries.length === 1 ? "" : "s"}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Public Rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {PUBLIC_RULES.map((rule) => (
                <div key={rule.type} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-ink truncate">{rule.label}</div>
                    <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                      {rule.type}
                    </div>
                  </div>
                  <div className="font-mono text-xs text-amber">+{formatPoints(rule.points)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Recent Events</CardTitle>
            <Activity className="h-4 w-4 text-ink-faint" />
          </CardHeader>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <EmptyState text={loading ? "Loading recent events..." : "No recent events."} />
            ) : (
              <div className="divide-y divide-hairline">
                {recent.map((event) => {
                  const eventTypeLabel = formatEventType(event.type);
                  return (
                    <div
                      key={event.id}
                      className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_120px] gap-2 px-5 py-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {eventTypeLabel && <Badge>{eventTypeLabel}</Badge>}
                          <span className="font-mono text-xs text-ink truncate">{event.reason}</span>
                        </div>
                        <div className="mt-2 font-mono text-[10px] text-ink-faint truncate">
                          {event.wallet}
                        </div>
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint md:text-right">
                        {formatTime(event.createdAt)}
                      </div>
                      <div className="font-serif text-2xl text-amber md:text-right">
                        +{formatPoints(event.points)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent>
        <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
          {label}
        </div>
        <div className="mt-1 font-serif text-3xl text-ink">{value}</div>
        <div className="mt-1 text-xs text-ink-faint">{detail}</div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <Medal className="mx-auto h-5 w-5 text-ink-faint" />
      <p className="mt-3 font-serif italic text-lg text-ink-dim">{text}</p>
    </div>
  );
}
