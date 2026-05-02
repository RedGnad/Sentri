// Real-time market data source for the treasury agent.
// Pulls ETH/USD spot from FOUR independent sources (Binance, CoinGecko,
// Coinbase, Kraken) in parallel and returns the median, with a 2-of-4
// quorum required. Single-source dependency is unsafe for capital
// allocation — a hijacked or hallucinating exchange feed could push the
// vault toward bad swap decisions even with the on-chain slippage guard.

export interface MarketSnapshot {
  ethUsd: number;          // median across reachable sources
  change24h: number;       // 24h percent change (Binance preferred, CoinGecko fallback)
  source: string;          // "median:binance,coingecko,kraken,coinbase"
  timestamp: number;
  sourceCount: number;     // how many sources contributed (>= 2 required)
  spreadPct: number;       // (max - min) / median × 100, for monitoring
}

interface SourceResult {
  source: string;
  ethUsd: number;
  change24h?: number;
}

const FETCH_TIMEOUT_MS = 3_500;
const MIN_QUORUM = 2;

async function fetchBinance(): Promise<SourceResult> {
  const res = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = (await res.json()) as { lastPrice: string; priceChangePercent: string };
  return {
    source: "binance",
    ethUsd: Number(data.lastPrice),
    change24h: Number(data.priceChangePercent),
  };
}

async function fetchCoinGecko(): Promise<SourceResult> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = (await res.json()) as { ethereum: { usd: number; usd_24h_change: number } };
  return {
    source: "coingecko",
    ethUsd: data.ethereum.usd,
    change24h: data.ethereum.usd_24h_change,
  };
}

async function fetchCoinbase(): Promise<SourceResult> {
  const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);
  const data = (await res.json()) as { data: { amount: string } };
  return { source: "coinbase", ethUsd: Number(data.data.amount) };
}

async function fetchKraken(): Promise<SourceResult> {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSDT", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Kraken ${res.status}`);
  const data = (await res.json()) as { result: Record<string, { c: string[] }> };
  const tickers = Object.values(data.result);
  if (tickers.length === 0) throw new Error("Kraken empty result");
  return { source: "kraken", ethUsd: Number(tickers[0].c[0]) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const settled = await Promise.allSettled([
    fetchBinance(),
    fetchCoinGecko(),
    fetchCoinbase(),
    fetchKraken(),
  ]);

  const successes: SourceResult[] = [];
  const failures: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") successes.push(r.value);
    else failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  if (successes.length < MIN_QUORUM) {
    throw new Error(
      `Insufficient market quorum: ${successes.length}/4 sources succeeded ` +
        `(need ≥ ${MIN_QUORUM}). Failures: ${failures.join(" | ")}`,
    );
  }

  const prices = successes.map((s) => s.ethUsd);
  const med = median(prices);
  const spreadPct = prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / med) * 100 : 0;

  // 24h change: prefer Binance, fallback to CoinGecko, otherwise 0.
  const changeSource =
    successes.find((s) => s.source === "binance" && s.change24h !== undefined) ??
    successes.find((s) => s.source === "coingecko" && s.change24h !== undefined);
  const change24h = changeSource?.change24h ?? 0;

  return {
    ethUsd: med,
    change24h,
    source: `median:${successes.map((s) => s.source).join(",")}`,
    timestamp: Date.now(),
    sourceCount: successes.length,
    spreadPct,
  };
}
