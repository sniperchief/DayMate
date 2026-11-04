import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Walrus Memory SDK and its Sui/SEAL peers use dynamic imports and
  // Node APIs; load them with native require on the server, never bundle.
  serverExternalPackages: ["@mysten-incubation/memwal", "@mysten/sui", "@mysten/seal"],
  experimental: {
    serverActions: {
      // photos are limited to 4 MB; leave room for multipart overhead
      bodySizeLimit: "5mb",
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
