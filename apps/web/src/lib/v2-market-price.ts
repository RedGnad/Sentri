const PYTH_HERMES_URL =
  process.env.NEXT_PUBLIC_PYTH_HERMES_URL ??
  "https://hermes.pyth.network/v2/updates/price/latest";

export interface PythMarketPrice {
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
}

interface PythHermesResponse {
  parsed?: Array<{
    id?: string;
    price?: {
      price?: string;
      conf?: string;
      expo?: number;
      publish_time?: number;
    };
  }>;
}

function normalizePriceId(priceId: string): string {
  return priceId.startsWith("0x") ? priceId.slice(2) : priceId;
}

export function quoteRiskToBaseUnits(
  riskBalance: bigint,
  marketPrice: PythMarketPrice,
  baseDecimals = 6,
  riskDecimals = 18,
): bigint {
  if (riskBalance <= 0n || marketPrice.price <= 0n) return 0n;

  const exponent = marketPrice.expo + baseDecimals - riskDecimals;
  const scaled = riskBalance * marketPrice.price;

  if (exponent >= 0) {
    return scaled * 10n ** BigInt(exponent);
  }

  return scaled / 10n ** BigInt(-exponent);
}

export async function fetchPythMarketPrice(
  priceId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PythMarketPrice | null> {
  try {
    const url = new URL(PYTH_HERMES_URL);
    url.searchParams.append("ids[]", normalizePriceId(priceId));

    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: options.signal,
    });
    if (!res.ok) return null;

    const body = (await res.json()) as PythHermesResponse;
    const raw = body.parsed?.[0]?.price;
    if (!raw?.price || raw.expo === undefined) return null;

    const price = BigInt(raw.price);
    if (price <= 0n) return null;

    return {
      price,
      conf: raw.conf ? BigInt(raw.conf) : 0n,
      expo: raw.expo,
      publishTime: raw.publish_time ?? 0,
    };
  } catch {
    return null;
  }
}
