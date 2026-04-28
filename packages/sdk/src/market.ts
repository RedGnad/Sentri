// Real-time market data source for the treasury agent.
// Pulls ETH/USD from Binance public ticker, with CoinGecko as fallback.
// The agent signs the observation with its TEE attestation before pushing
// it on-chain to SentriPriceFeed.

export interface MarketSnapshot {
  ethUsd: number;
  change24h: number;
  source: string;
  timestamp: number;
}

async function fetchBinance(): Promise<MarketSnapshot> {
  const res = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT");
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = (await res.json()) as { lastPrice: string; priceChangePercent: string };
  return {
    ethUsd: Number(data.lastPrice),
    change24h: Number(data.priceChangePercent),
    source: "binance",
    timestamp: Date.now(),
  };
}

async function fetchCoinGecko(): Promise<MarketSnapshot> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = (await res.json()) as { ethereum: { usd: number; usd_24h_change: number } };
  return {
    ethUsd: data.ethereum.usd,
    change24h: data.ethereum.usd_24h_change,
    source: "coingecko",
    timestamp: Date.now(),
  };
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  try {
    return await fetchBinance();
  } catch {
    return await fetchCoinGecko();
  }
}
