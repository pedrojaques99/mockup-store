import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-0acbd500af3b4beaa8b93b07f6490d58.r2.dev",
      },
    ],
  },
  serverExternalPackages: ["ag-psd", "sharp", "mongodb", "@printmadehq/mockup-generator", "puppeteer", "canvas"],
};

export default nextConfig;
