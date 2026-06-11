import { readFileSync } from "fs";
import { resolve } from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdk: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkReady: Promise<any> | null = null;
let lastUsed = 0;

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 min — kill idle SDK

async function getSdk() {
  if (sdk) {
    lastUsed = Date.now();
    return sdk;
  }

  if (sdkReady) return sdkReady;

  sdkReady = (async () => {
    const { MockupSDK } = await import("@printmadehq/mockup-generator");
    sdk = await MockupSDK.create({ mode: "serverless" });
    lastUsed = Date.now();
    console.log("[render-pool] SDK warmed up");

    // Auto-kill after idle
    const check = setInterval(() => {
      if (Date.now() - lastUsed > IDLE_TIMEOUT && sdk) {
        console.log("[render-pool] Idle timeout, destroying SDK");
        try { sdk.destroy?.(); } catch {}
        sdk = null;
        sdkReady = null;
        clearInterval(check);
      }
    }, 30_000);

    return sdk;
  })();

  return sdkReady;
}

export interface RenderOpts {
  psdPath: string;
  artPath: string;
  smartObject: string;
  hideLayers?: string[];
}

export async function renderMockup(opts: RenderOpts): Promise<Buffer> {
  const instance = await getSdk();

  const psdBuffer = readFileSync(resolve(opts.psdPath));
  const artBuffer = readFileSync(resolve(opts.artPath));

  const replacements: Array<{ name: string; image: Buffer; fillMode: string }> = [
    { name: opts.smartObject, image: artBuffer, fillMode: "fill" },
  ];

  if (opts.hideLayers?.length) {
    const sharp = (await import("sharp")).default;
    const transparent = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();

    for (const layer of opts.hideLayers) {
      replacements.push({ name: layer, image: transparent, fillMode: "fill" });
    }
  }

  const result = await instance.generate({
    psd: psdBuffer,
    replacements,
    exports: [{ format: "png", quality: 90 }],
  });

  if (!result.exports?.length) {
    throw new Error("No output produced");
  }

  return Buffer.from(result.exports[0].buffer);
}

// Pre-warm on import
getSdk().catch((err) => console.error("[render-pool] Warm-up failed:", err));
