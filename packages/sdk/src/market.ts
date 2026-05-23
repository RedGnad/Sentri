// Real-time market data source for the treasury agent.
// Galileo defaults to ETH/USD for MockWETH. 0G mainnet can set
// MARKET_ASSET=W0G to price W0G/USD for the USDC.E/W0G real-asset stack.
import { ethers } from "ethers";

export interface MarketSnapshot {
  priceUsd: number;        // median across reachable sources
  ethUsd: number;          // backward-compatible alias for priceUsd
  riskSymbol: string;      // ETH or W0G
  baseSymbol: string;      // USDC, USDC.E, etc.
  change24h: number;       // 24h percent change
  change24hAvailable: boolean;
  change24hSource?: string;
  source: string;          // "median:binance,coingecko,kraken,coinbase"
  timestamp: number;
  sourceCount: number;     // how many sources contributed (>= 2 required)
  spreadPct: number;       // (max - min) / median × 100, for monitoring
  rawSources: Array<{ source: string; priceUsd: number; ethUsd: number }>;
  health: "fresh" | "degraded" | "external-only";
  tradingAllowed: boolean;
  failures: string[];
  requiredSourceCount: number;  // MIN_QUORUM threshold applied to this snapshot
}

interface SourceResult {
  source: string;
  priceUsd: number;
  change24h?: number;
}

interface SourceFetchLog {
  source: string;
  endpoint: string;
  statusCode?: number;
  durationMs: number;
  attempt: number;
  retryAfter?: string | null;
  bodyPreview?: string;
  ok: boolean;
  error?: string;
}

export interface MarketDataHealth {
  ok: boolean;
  asset: string;
  lastGoodMarketAt: number | null;
  lastSourceCount: number;
  requiredSourceCount: number;
  failedSources: string[];
  consecutiveFailures: number;
  cacheAgeSec: number | null;
}

export class MarketDataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataUnavailableError";
  }
}

const FETCH_TIMEOUT_MS = 3_500;
const MIN_QUORUM = 2;
const MARKET_ASSET = (process.env.MARKET_ASSET ?? process.env.SENTRI_MARKET_ASSET ?? "ETH").toUpperCase();
const BASE_SYMBOL = process.env.SENTRI_BASE_SYMBOL ?? (MARKET_ASSET === "W0G" ? "USDC.E" : "USDC");
const RISK_SYMBOL = process.env.SENTRI_RISK_SYMBOL ?? MARKET_ASSET;
const MAX_MARKET_SPREAD_BPS = Number(process.env.MAX_MARKET_SPREAD_BPS ?? "500");
const ZERO_G_MAINNET_RPC = process.env.RPC_URL ?? "https://evmrpc.0g.ai";
const ZERO_G_MAINNET_JAINE_POOL =
  process.env.ZERO_G_MAINNET_JAINE_USDCE_W0G_POOL_ADDRESS ??
  "0xa9e824Eddb9677fB2189AB9c439238A83695C091";
const ZERO_G_MAINNET_W0G =
  process.env.ZERO_G_MAINNET_W0G_ADDRESS ?? "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";
const ZERO_G_MAINNET_USDCE =
  process.env.ZERO_G_MAINNET_USDCE_ADDRESS ?? "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E";
const MARKET_SNAPSHOT_CACHE_TTL_MS = Math.min(
  Math.max(0, Number(process.env.MARKET_SNAPSHOT_CACHE_TTL_MS ?? "45000")),
  60_000,
);
const PYTH_RETRY_DELAY_MS = Number(process.env.PYTH_RETRY_DELAY_MS ?? "250");
const PYTH_BACKOFF_MS = Number(process.env.PYTH_BACKOFF_MS ?? "10000");
const COINGECKO_BACKOFF_MS = Number(process.env.COINGECKO_BACKOFF_MS ?? "90000");

// Pyth Network is the official 0G mainnet oracle (day-1 partnership, 2000+ feeds).
// Hermes is the public price-update endpoint; treat it as rate-limited and cache
// the cycle snapshot so multiple vaults do not fan out duplicate requests.
// Feed id `Crypto.0G/USD` is the canonical 0G token price (publishers include
// Cboe, Binance, OKX, Jane Street, etc. — fully decentralised).
const PYTH_HERMES_BASE = process.env.PYTH_HERMES_BASE ?? "https://hermes.pyth.network";
// When PYTH_ONCHAIN_ADDRESS is set, the agent submits the Pyth VAA on-chain
// (Pyth pull model) instead of relying solely on keeper-pushed SentriPriceFeed.
// See: https://docs.pyth.network/price-feeds/use-real-time-data/evm
const PYTH_ONCHAIN_ADDRESS = process.env.PYTH_ONCHAIN_ADDRESS ?? "";

const IPYTH_ABI = [
  "function getUpdateFee(bytes[] calldata updateData) view returns (uint256)",
  "function updatePriceFeeds(bytes[] calldata updateData) payable",
  "function getPriceNoOlderThan(bytes32 id, uint age) view returns (tuple(int64 price, uint64 conf, int32 expo, uint publishTime) price)",
] as const;
const PYTH_FEED_W0G_USD =
  process.env.PYTH_FEED_W0G_USD ??
  "fa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070";
const PYTH_MAX_AGE_S = Number(process.env.PYTH_MAX_AGE_S ?? "60");
const PYTH_UPDATE_CACHE_MS = Math.min(5_000, PYTH_MAX_AGE_S * 1000);

const JAINE_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
] as const;

const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"] as const;

let cachedSnapshot: { asset: string; snapshot: MarketSnapshot } | null = null;
let lastGoodMarketAt: number | null = null;
let lastSourceCount = 0;
let lastFailedSources: string[] = [];
let consecutiveFailures = 0;
let pythUpdateCache: { fetchedAt: number; data: PythUpdateResponse } | null = null;
const sourceBackoff = new Map<string, { until: number; reason: string }>();

interface PythUpdateResponse {
  binary?: { data: string[] };
  parsed?: Array<{
    price: { price: string; expo: number; conf: string; publish_time: number };
  }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bodyPreview(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 180);
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

function setBackoff(source: string, ms: number, reason: string): void {
  sourceBackoff.set(source, { until: Date.now() + ms, reason });
}

function sourceBackoffError(source: string): Error | null {
  const backoff = sourceBackoff.get(source);
  if (!backoff) return null;
  const remainingMs = backoff.until - Date.now();
  if (remainingMs <= 0) {
    sourceBackoff.delete(source);
    return null;
  }
  return new Error(`${source} in backoff for ${Math.ceil(remainingMs / 1000)}s: ${backoff.reason}`);
}

function logSourceFetch(event: SourceFetchLog): void {
  const retryAfter = event.retryAfter ? ` retryAfter=${JSON.stringify(event.retryAfter)}` : "";
  const status = event.statusCode === undefined ? "n/a" : String(event.statusCode);
  const body = event.bodyPreview ? ` body=${JSON.stringify(event.bodyPreview)}` : "";
  const error = event.error ? ` error=${JSON.stringify(event.error)}` : "";
  console.log(
    `[market] source=${event.source} endpoint=${JSON.stringify(event.endpoint)} ` +
      `status=${status} durationMs=${event.durationMs} attempt=${event.attempt}${retryAfter} ok=${event.ok}${body}${error}`,
  );
}

function markLogged(error: Error): Error {
  (error as Error & { marketLogged?: boolean }).marketLogged = true;
  return error;
}

function wasLogged(err: unknown): boolean {
  return Boolean((err as { marketLogged?: boolean } | null)?.marketLogged);
}

async function fetchJson<T>(
  source: string,
  endpoint: string,
  options: { retries?: number; retryStatuses?: number[]; backoffOn429?: boolean; backoffOn503?: boolean } = {},
): Promise<T> {
  const backoffErr = sourceBackoffError(source);
  if (backoffErr) throw backoffErr;

  const maxAttempts = 1 + (options.retries ?? 0);
  const retryStatuses = new Set(options.retryStatuses ?? []);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const retryAfter = res.headers.get("retry-after");
      const text = await res.text();
      const durationMs = Date.now() - startedAt;
      if (!res.ok) {
        logSourceFetch({
          source,
          endpoint,
          statusCode: res.status,
          durationMs,
          attempt,
          retryAfter,
          ok: false,
          bodyPreview: bodyPreview(text),
        });
        if (res.status === 429 && options.backoffOn429) {
          setBackoff(source, retryAfterMs(retryAfter) ?? COINGECKO_BACKOFF_MS, `HTTP 429 from ${source}`);
        }
        if (res.status === 503 && options.backoffOn503 && attempt >= maxAttempts) {
          setBackoff(source, PYTH_BACKOFF_MS, `HTTP 503 from ${source}`);
        }
        if (retryStatuses.has(res.status) && attempt < maxAttempts) {
          await sleep(PYTH_RETRY_DELAY_MS);
          continue;
        }
        throw markLogged(new Error(`${source} ${res.status}`));
      }
      try {
        const parsed = JSON.parse(text) as T;
        logSourceFetch({ source, endpoint, statusCode: res.status, durationMs, attempt, retryAfter, ok: true });
        return parsed;
      } catch (err) {
        logSourceFetch({
          source,
          endpoint,
          statusCode: res.status,
          durationMs,
          attempt,
          retryAfter,
          ok: false,
          bodyPreview: bodyPreview(text),
          error: err instanceof Error ? err.message : String(err),
        });
        throw markLogged(err instanceof Error ? err : new Error(String(err)));
      }
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (wasLogged(err)) {
        // Already logged with status/body above. Non-retry HTTP failures stop here.
        throw err;
      } else if (err instanceof Error && err.name === "AbortError") {
        logSourceFetch({ source, endpoint, durationMs, attempt, ok: false, error: "timeout" });
      } else if (!(err instanceof SyntaxError)) {
        logSourceFetch({
          source,
          endpoint,
          durationMs,
          attempt,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (attempt < maxAttempts && !(err instanceof SyntaxError)) {
        await sleep(PYTH_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${source} failed`);
}

async function traceSource<T>(source: string, endpoint: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logSourceFetch({ source, endpoint, durationMs: Date.now() - startedAt, attempt: 1, ok: true });
    return result;
  } catch (err) {
    logSourceFetch({
      source,
      endpoint,
      durationMs: Date.now() - startedAt,
      attempt: 1,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function fetchBinance(): Promise<SourceResult> {
  const data = await fetchJson<{ lastPrice: string; priceChangePercent: string }>(
    "binance",
    "https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT",
  );
  return {
    source: "binance",
    priceUsd: Number(data.lastPrice),
    change24h: Number(data.priceChangePercent),
  };
}

async function fetchCoinGecko(): Promise<SourceResult> {
  const data = await fetchJson<{ ethereum: { usd: number; usd_24h_change: number } }>(
    "coingecko",
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
    { backoffOn429: true },
  );
  return {
    source: "coingecko",
    priceUsd: data.ethereum.usd,
    change24h: data.ethereum.usd_24h_change,
  };
}

async function fetchCoinbase(): Promise<SourceResult> {
  const data = await fetchJson<{ data: { amount: string } }>(
    "coinbase",
    "https://api.coinbase.com/v2/prices/ETH-USD/spot",
  );
  return { source: "coinbase", priceUsd: Number(data.data.amount) };
}

async function fetchKraken(): Promise<SourceResult> {
  const data = await fetchJson<{ result: Record<string, { c: string[] }> }>(
    "kraken",
    "https://api.kraken.com/0/public/Ticker?pair=ETHUSDT",
  );
  const tickers = Object.values(data.result);
  if (tickers.length === 0) throw new Error("Kraken empty result");
  return { source: "kraken", priceUsd: Number(tickers[0].c[0]) };
}

/**
 * Pyth on-chain pull model (evidence-only) — submits the latest VAA to the
 * deployed Pyth contract so any subsequent reader can call
 * getPriceNoOlderThan on-chain without keeper trust.
 *
 * ⚠️  Currently NON-BLOCKING / evidence-only: the vault does not yet gate
 * execution on a fresh Pyth read. SentriPriceFeed remains the execution
 * oracle. This provides auditable on-chain price evidence alongside the
 * keeper-pushed feed, but is not yet enforcement-level.
 *
 * Gated by PYTH_ONCHAIN_ADDRESS env var.
 * Pattern: https://docs.pyth.network/price-feeds/use-real-time-data/evm
 * 1. Fetch VAA bytes from Hermes (binary/hex encoding).
 * 2. Call getUpdateFee to compute required fee.
 * 3. Submit updatePriceFeeds(vaas, {value: fee}) on-chain — agent wallet pays.
 * 4. Callers can now read getPriceNoOlderThan(feedId, maxAge) trustlessly.
 */
export async function updatePythOnChain(signer: ethers.Signer): Promise<void> {
  if (!PYTH_ONCHAIN_ADDRESS) return;
  const data = await fetchW0GPythUpdate();
  const vaas = (data.binary?.data ?? []).map((d: string) => `0x${d}` as `0x${string}`);
  if (vaas.length === 0) throw new Error("Pyth on-chain pull: no VAA bytes returned by Hermes");
  const pyth = new ethers.Contract(PYTH_ONCHAIN_ADDRESS, IPYTH_ABI, signer);
  const fee: bigint = await (pyth.getUpdateFee(vaas) as Promise<bigint>);
  const tx = await (pyth.updatePriceFeeds(vaas, { value: fee }) as Promise<ethers.TransactionResponse>);
  await tx.wait();
}

/**
 * Pyth Network price feed for 0G/USD via the public Hermes endpoint.
 *
 * Pyth is the official 0G mainnet oracle. Hermes returns the latest signed
 * price update authored by the Pyth publisher set (≥100 institutions).
 * We use the parsed JSON form here — the agent does not push the update
 * on-chain because the vault's slippage gate already reads from
 * SentriPriceFeed (which the agent pushes itself, derived from the median
 * of all reachable sources in this module).
 */
async function fetchW0GPythUpdate(): Promise<PythUpdateResponse> {
  if (pythUpdateCache && Date.now() - pythUpdateCache.fetchedAt <= PYTH_UPDATE_CACHE_MS) {
    return pythUpdateCache.data;
  }
  const url = `${PYTH_HERMES_BASE}/v2/updates/price/latest?ids[]=${PYTH_FEED_W0G_USD}&parsed=true&encoding=hex`;
  const data = await fetchJson<PythUpdateResponse>("pyth-hermes:0g-usd", url, {
    retries: 1,
    retryStatuses: [503],
    backoffOn503: true,
  });
  pythUpdateCache = { fetchedAt: Date.now(), data };
  return data;
}

async function fetchW0GPyth(): Promise<SourceResult> {
  const data = await fetchW0GPythUpdate();
  const entry = data.parsed?.[0];
  if (!entry) throw new Error("Pyth Hermes empty parsed payload");

  const rawPrice = Number(entry.price.price);
  const expo = entry.price.expo;
  const priceUsd = rawPrice * 10 ** expo;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`Pyth Hermes invalid price: ${priceUsd}`);
  }

  const ageS = Math.floor(Date.now() / 1000) - entry.price.publish_time;
  if (ageS > PYTH_MAX_AGE_S) {
    throw new Error(`Pyth Hermes price stale: ${ageS}s old (max ${PYTH_MAX_AGE_S}s)`);
  }

  return { source: "pyth:0g-usd", priceUsd };
}

/**
 * Optional CoinGecko probe for 24h change only. Pyth and Jaine slot0 do not
 * expose 24h change; CoinGecko is the convenience source for that metric.
 * Kept opportunistic — its failure does not block trading because the
 * mandatory pair (Jaine on-chain + Pyth) covers price discovery.
 */
async function fetchW0G24hChangeCoinGecko(): Promise<SourceResult> {
  const data = await fetchJson<{ "wrapped-0g": { usd: number; usd_24h_change: number } }>(
    "coingecko:wrapped-0g",
    "https://api.coingecko.com/api/v3/simple/price?ids=wrapped-0g&vs_currencies=usd&include_24hr_change=true",
    { backoffOn429: true },
  );
  return {
    source: "coingecko:wrapped-0g",
    priceUsd: data["wrapped-0g"].usd,
    change24h: data["wrapped-0g"].usd_24h_change,
  };
}

async function fetchW0GJaineSpot(): Promise<SourceResult> {
  return traceSource(
    "jaine:onchain-slot0",
    `${ZERO_G_MAINNET_RPC} pool=${ZERO_G_MAINNET_JAINE_POOL}`,
    async () => {
      const provider = new ethers.JsonRpcProvider(ZERO_G_MAINNET_RPC);
      const pool = new ethers.Contract(ZERO_G_MAINNET_JAINE_POOL, JAINE_POOL_ABI, provider);
      const [token0, token1, slot0] = await Promise.all([
        pool.token0() as Promise<string>,
        pool.token1() as Promise<string>,
        pool.slot0() as Promise<[bigint, bigint, number, number, number, number, boolean]>,
      ]);

      const token0Norm = token0.toLowerCase();
      const token1Norm = token1.toLowerCase();
      const w0gNorm = ZERO_G_MAINNET_W0G.toLowerCase();
      const usdceNorm = ZERO_G_MAINNET_USDCE.toLowerCase();
      if (
        !((token0Norm === w0gNorm && token1Norm === usdceNorm) ||
          (token0Norm === usdceNorm && token1Norm === w0gNorm))
      ) {
        throw new Error(`Jaine pool token mismatch: token0=${token0}, token1=${token1}`);
      }

      const token0Contract = new ethers.Contract(token0, ERC20_DECIMALS_ABI, provider);
      const token1Contract = new ethers.Contract(token1, ERC20_DECIMALS_ABI, provider);
      const [dec0, dec1] = await Promise.all([
        token0Contract.decimals() as Promise<number>,
        token1Contract.decimals() as Promise<number>,
      ]);

      const sqrtPriceX96 = BigInt(slot0[0]);
      if (sqrtPriceX96 <= 0n) throw new Error("Jaine slot0 missing sqrtPriceX96");

      // V3 slot0 encodes token1/token0 as sqrtPriceX96 in Q64.96.
      const rawToken1PerToken0 = Number(sqrtPriceX96 * sqrtPriceX96) / Number(2n ** 192n);
      const adjustedToken1PerToken0 = rawToken1PerToken0 * 10 ** (Number(dec0) - Number(dec1));
      const w0gUsd =
        token0Norm === w0gNorm
          ? adjustedToken1PerToken0
          : 1 / adjustedToken1PerToken0;

      if (!Number.isFinite(w0gUsd) || w0gUsd <= 0) {
        throw new Error(`Jaine slot0 invalid W0G price: ${w0gUsd}`);
      }

      return {
        source: "jaine:onchain-slot0",
        priceUsd: w0gUsd,
      };
    },
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function getMarketDataHealth(): MarketDataHealth {
  const cacheAgeSec = cachedSnapshot ? Math.floor((Date.now() - cachedSnapshot.snapshot.timestamp) / 1000) : null;
  return {
    ok: Boolean(
      cachedSnapshot &&
        cachedSnapshot.asset === MARKET_ASSET &&
        cacheAgeSec !== null &&
        cacheAgeSec * 1000 <= MARKET_SNAPSHOT_CACHE_TTL_MS &&
        cachedSnapshot.snapshot.tradingAllowed,
    ),
    asset: MARKET_ASSET,
    lastGoodMarketAt,
    lastSourceCount,
    requiredSourceCount: MIN_QUORUM,
    failedSources: lastFailedSources,
    consecutiveFailures,
    cacheAgeSec,
  };
}

export function isMarketDataUnavailableError(err: unknown): boolean {
  return err instanceof MarketDataUnavailableError;
}

interface MarketSnapshotOptions {
  forceRefresh?: boolean;
  maxAgeMs?: number;
}

export async function getMarketSnapshot(options: MarketSnapshotOptions = {}): Promise<MarketSnapshot> {
  const maxAgeMs = Math.min(options.maxAgeMs ?? MARKET_SNAPSHOT_CACHE_TTL_MS, MARKET_SNAPSHOT_CACHE_TTL_MS);
  if (!options.forceRefresh && cachedSnapshot?.asset === MARKET_ASSET) {
    const ageMs = Date.now() - cachedSnapshot.snapshot.timestamp;
    if (ageMs <= maxAgeMs) {
      return cachedSnapshot.snapshot;
    }
  }

  // W0G path (0G mainnet): mandatory cross-validation between an on-chain
  // source (Jaine V3 slot0) and Pyth's decentralised publisher network.
  // CoinGecko is opportunistic for 24h change only and never gates trading.
  // ETH path (Galileo rehearsal): 4-source CEX median (Binance/CoinGecko/
  // Coinbase/Kraken) since these endpoints don't rate-limit ETH.
  const providers =
    MARKET_ASSET === "W0G"
      ? [fetchW0GJaineSpot(), fetchW0GPyth(), fetchW0G24hChangeCoinGecko()]
      : [fetchBinance(), fetchCoinGecko(), fetchCoinbase(), fetchKraken()];

  const settled = await Promise.allSettled(providers);

  const successes: SourceResult[] = [];
  const failures: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") successes.push(r.value);
    else failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  lastFailedSources = failures;

  if (successes.length < MIN_QUORUM) {
    consecutiveFailures++;
    throw new MarketDataUnavailableError(
      `Insufficient market quorum: ${successes.length}/${providers.length} sources succeeded ` +
        `(need ≥ ${MIN_QUORUM}). Asset: ${MARKET_ASSET}. Failures: ${failures.join(" | ")}`,
    );
  }

  // For the W0G path, drop the opportunistic CoinGecko price from the median:
  // it lags the on-chain price (last 24h average refresh) and could skew the
  // median. We still keep its 24h change signal below.
  const priceContributors =
    MARKET_ASSET === "W0G"
      ? successes.filter((s) => s.source !== "coingecko:wrapped-0g")
      : successes;
  if (priceContributors.length < MIN_QUORUM) {
    consecutiveFailures++;
    throw new MarketDataUnavailableError(
      `Insufficient market price quorum: ${priceContributors.length}/${MIN_QUORUM} price sources succeeded ` +
        `for ${MARKET_ASSET}. Failures: ${failures.join(" | ") || "missing mandatory source"}`,
    );
  }
  const prices = priceContributors.map((s) => s.priceUsd);
  const med = median(prices);
  const spreadPct = prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / med) * 100 : 0;
  if (spreadPct * 100 > MAX_MARKET_SPREAD_BPS) {
    consecutiveFailures++;
    throw new MarketDataUnavailableError(
      `Market spread too wide for ${MARKET_ASSET}: ${spreadPct.toFixed(3)}% ` +
        `(max ${(MAX_MARKET_SPREAD_BPS / 100).toFixed(2)}%). Sources: ` +
        priceContributors.map((s) => `${s.source}=${s.priceUsd}`).join(" | "),
    );
  }

  // 24h change: it drives regime classification, so track whether it is truly
  // available instead of silently treating an unavailable source as flat (0%).
  const changeSource = successes.find((s) => s.change24h !== undefined && Number.isFinite(s.change24h));
  const change24h = changeSource?.change24h ?? 0;
  const hasJaineOnchain = successes.some((s) => s.source === "jaine:onchain-slot0");
  const hasPyth = successes.some((s) => s.source === "pyth:0g-usd");
  const tradingAllowed = MARKET_ASSET !== "W0G" || (hasJaineOnchain && hasPyth);
  const health: MarketSnapshot["health"] =
    MARKET_ASSET !== "W0G"
      ? "fresh"
      : tradingAllowed
        ? "fresh"
        : hasJaineOnchain
          ? "degraded"
          : "external-only";

  const snapshot: MarketSnapshot = {
    priceUsd: med,
    ethUsd: med,
    riskSymbol: RISK_SYMBOL,
    baseSymbol: BASE_SYMBOL,
    change24h,
    change24hAvailable: Boolean(changeSource),
    change24hSource: changeSource?.source,
    source: `median:${priceContributors.map((s) => s.source).join(",")}`,
    timestamp: Date.now(),
    sourceCount: priceContributors.length,
    spreadPct,
    rawSources: priceContributors.map((s) => ({ source: s.source, priceUsd: s.priceUsd, ethUsd: s.priceUsd })),
    health,
    tradingAllowed,
    failures,
    requiredSourceCount: MIN_QUORUM,
  };
  cachedSnapshot = { asset: MARKET_ASSET, snapshot };
  lastGoodMarketAt = snapshot.timestamp;
  lastSourceCount = snapshot.sourceCount;
  if (snapshot.tradingAllowed) consecutiveFailures = 0;
  return snapshot;
}
