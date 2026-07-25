import type { NextConfig } from "next";
import path from "path";

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
  // Thumbnail do grid é imutável por id (o id É o hash da cena) — sem isto o browser
  // revalidava os 60 cards da primeira página a cada visita. `must-revalidate` de fora
  // porque o arquivo pode ser regravado por um republish da mesma cena.
  async headers() {
    return [
      {
        source: "/photo-previews/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
  serverExternalPackages: [
    "ag-psd", "sharp", "mongodb", "@printmadehq/mockup-generator",
    "puppeteer", "canvas", "@visant/psd-engine",
  ],
  webpack(config, { isServer }) {
    // onnxruntime-web/all → prebuilt WebGPU+WASM bundle (SAM2 client-side segmentation)
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-web/all": path.join(process.cwd(), "node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs"),
    };

    // canvas is a native Node module. When psd-engine is resolved via a monorepo
    // junction, serverExternalPackages won't intercept it (path resolves to the
    // real disk location, not the package name). Use an externals function instead.
    const canvasExternal = (
      { request }: { request?: string },
      callback: (err?: Error | null, result?: string) => void,
    ) => {
      if (request === 'canvas' || request?.includes('canvas/index') || request?.includes('canvas/lib')) {
        // Server: load at runtime via require(); client/worker: stub as empty object.
        return callback(null, isServer ? 'commonjs canvas' : 'var {}');
      }
      callback();
    };

    const prev = config.externals;
    config.externals = Array.isArray(prev)
      ? [...prev, canvasExternal]
      : prev
        ? [prev, canvasExternal]
        : [canvasExternal];

    return config;
  },
};

export default nextConfig;
