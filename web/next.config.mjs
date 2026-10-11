/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // NFT art can live on any host, so `next/image` is allowed to reference any http(s) hostname.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    // ...but the built-in optimizer stays OFF. With it on, a wildcard turns /_next/image into an open image-resizing relay
    // for every host on the internet (cost and abuse on your bill). The UI loads images through plain <img> tags and our own
    // /api/nft/image proxy, which is SSRF-guarded, type-checked, size-capped and rate-limited.
    unoptimized: true,
  },
  webpack: (config) => {
    // wagmi's connectors barrel pulls in optional wallet SDKs (Coinbase/x402) that this app never
    // uses, since only the injected connector is configured. Stub them so the build resolves.
    for (const m of ["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"]) {
      config.resolve.alias[m] = false;
    }
    // @metamask/sdk (pulled in by wagmi's connector barrel) optionally imports React Native storage; this app never runs there.
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};
export default nextConfig;
