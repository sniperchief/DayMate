import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Walrus Memory SDK and its Sui/SEAL peers use dynamic imports and
  // Node APIs; load them with native require on the server, never bundle.
  serverExternalPackages: ["@mysten-incubation/memwal", "@mysten/sui", "@mysten/seal", "@grpc/grpc-js", "@protobuf-ts/grpc-transport"],
  // Dev only: let a phone/tablet on your Wi-Fi load the dev server, e.g.
  // DAYMATE_DEV_ORIGINS=192.168.1.20 (comma-separated). Ignored in production.
  allowedDevOrigins: (process.env.DAYMATE_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  experimental: {
    serverActions: {
      // photos are limited to 4 MB; leave room for multipart overhead
      bodySizeLimit: "5mb",
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
