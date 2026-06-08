/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // @privy-io/react-auth references optional integrations (Stripe onramp,
    // Farcaster mini-app, Abstract Global Wallet) behind runtime feature gates
    // we don't enable. They are optional peer deps, so they aren't installed and
    // webpack fails to resolve them at build time. Alias them to `false` so the
    // bundler treats them as empty modules — safe because the code paths that
    // would use them are never reached in our config (email + wallet only).
    config.resolve.alias = {
      ...config.resolve.alias,
      "@stripe/crypto": false,
      "@farcaster/mini-app-solana": false,
      "@abstract-foundation/agw-client": false,
    };
    return config;
  },
};

export default nextConfig;
