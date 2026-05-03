// Real-time market data source for the treasury agent.
// Galileo defaults to ETH/USD for MockWETH. 0G mainnet can set
// MARKET_ASSET=W0G to price W0G/USD for the USDC.E/W0G real-asset stack.

export interface MarketSnapshot {
  priceUsd: number;        // median across reachable sources
  ethUsd: number;          // backward-compatible alias for priceUsd
  riskSymbol: string;      // ETH or W0G
  baseSymbol: string;      // USDC, USDC.E, etc.
  change24h: number;       // 24h percent change
  source: string;          // "median:binance,coingecko,kraken,coinbase"
  timestamp: number;
  sourceCount: number;     // how many sources contributed (>= 2 required)
  spreadPct: number;       // (max - min) / median × 100, for monitoring
  rawSources: Array<{ source: string; priceUsd: number; ethUsd: number }>;
}

interface SourceResult {
  source: string;
  priceUsd: number;
  change24h?: number;
}

const FETCH_TIMEOUT_MS = 3_500;
const MIN_QUORUM = 2;
const MARKET_ASSET = (process.env.MARKET_ASSET ?? process.env.SENTRI_MARKET_ASSET ?? "ETH").toUpperCase();
const BASE_SYMBOL = process.env.SENTRI_BASE_SYMBOL ?? (MARKET_ASSET === "W0G" ? "USDC.E" : "USDC");
const RISK_SYMBOL = process.env.SENTRI_RISK_SYMBOL ?? MARKET_ASSET;
const MAX_MARKET_SPREAD_BPS = Number(process.env.MAX_MARKET_SPREAD_BPS ?? "500");

async function fetchBinance(): Promise<SourceResult> {
  const res = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = (await res.json()) as { lastPrice: string; priceChangePercent: string };
  return {
    source: "binance",
    priceUsd: Number(data.lastPrice),
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
    priceUsd: data.ethereum.usd,
    change24h: data.ethereum.usd_24h_change,
  };
}

async function fetchCoinbase(): Promise<SourceResult> {
  const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);
  const data = (await res.json()) as { data: { amount: string } };
  return { source: "coinbase", priceUsd: Number(data.data.amount) };
}

async function fetchKraken(): Promise<SourceResult> {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSDT", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Kraken ${res.status}`);
  const data = (await res.json()) as { result: Record<string, { c: string[] }> };
  const tickers = Object.values(data.result);
  if (tickers.length === 0) throw new Error("Kraken empty result");
  return { source: "kraken", priceUsd: Number(tickers[0].c[0]) };
}

async function fetchW0GCoinGecko(): Promise<SourceResult> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=wrapped-0g&vs_currencies=usd&include_24hr_change=true",
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`CoinGecko W0G ${res.status}`);
  const data = (await res.json()) as { "wrapped-0g": { usd: number; usd_24h_change: number } };
  return {
    source: "coingecko:wrapped-0g",
    priceUsd: data["wrapped-0g"].usd,
    change24h: data["wrapped-0g"].usd_24h_change,
  };
}

async function fetchW0GGeckoTerminal(): Promise<SourceResult> {
  const pool = process.env.ZERO_G_MAINNET_JAINE_USDCE_W0G_POOL_ADDRESS ??
    "0xa9e824EDDb9677fB2189aB9C439238a83695c091";
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/0g/pools/${pool}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GeckoTerminal W0G ${res.status}`);
  const data = (await res.json()) as {
    data?: { attributes?: { quote_token_price_usd?: string; base_token_price_usd?: string; price_change_percentage?: { h24?: string } } };
  };
  const attrs = data.data?.attributes;
  // GeckoTerminal names this pool "USDC.e / W0G": base token is USDC.e and
  // quote token is W0G. We need the W0G/USD price for the vault's risk feed.
  const price = Number(attrs?.quote_token_price_usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error("GeckoTerminal W0G missing price");
  return {
    source: "geckoterminal:jaine-usdce-w0g",
    priceUsd: price,
    change24h: attrs?.price_change_percentage?.h24 ? Number(attrs.price_change_percentage.h24) : undefined,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const providers =
    MARKET_ASSET === "W0G"
      ? [fetchW0GCoinGecko(), fetchW0GGeckoTerminal()]
      : [fetchBinance(), fetchCoinGecko(), fetchCoinbase(), fetchKraken()];

  const settled = await Promise.allSettled(providers);

  const successes: SourceResult[] = [];
  const failures: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") successes.push(r.value);
    else failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  if (successes.length < MIN_QUORUM) {
    throw new Error(
      `Insufficient market quorum: ${successes.length}/4 sources succeeded ` +
        `(need ≥ ${MIN_QUORUM}). Asset: ${MARKET_ASSET}. Failures: ${failures.join(" | ")}`,
    );
  }

  const prices = successes.map((s) => s.priceUsd);
  const med = median(prices);
  const spreadPct = prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / med) * 100 : 0;
  if (spreadPct * 100 > MAX_MARKET_SPREAD_BPS) {
    throw new Error(
      `Market spread too wide for ${MARKET_ASSET}: ${spreadPct.toFixed(3)}% ` +
        `(max ${(MAX_MARKET_SPREAD_BPS / 100).toFixed(2)}%). Sources: ` +
        successes.map((s) => `${s.source}=${s.priceUsd}`).join(" | "),
    );
  }

  // 24h change: prefer the first source that exposes it, otherwise 0.
  const changeSource = successes.find((s) => s.change24h !== undefined);
  const change24h = changeSource?.change24h ?? 0;

  return {
    priceUsd: med,
    ethUsd: med,
    riskSymbol: RISK_SYMBOL,
    baseSymbol: BASE_SYMBOL,
    change24h,
    source: `median:${successes.map((s) => s.source).join(",")}`,
    timestamp: Date.now(),
    sourceCount: successes.length,
    spreadPct,
    rawSources: successes.map((s) => ({ source: s.source, priceUsd: s.priceUsd, ethUsd: s.priceUsd })),
  };
}
