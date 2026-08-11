/// <reference lib="webworker" />
/**
 * Client-side PSD preview renderer.
 * Runs in a Web Worker — uses OffscreenCanvas + psd-engine (SSOT).
 * Only used for preview renders; final export still goes to render-server.
 *
 * PSD is fetched once and cached inside the worker by path.
 * Subsequent previews for the same PSD (crop/zoom changes) skip the fetch.
 */

import * as agPsd from "ag-psd";
import {
  flattenLayers,
  replaceLinkedSmartObjects,
  composePsd,
  preloadDisplacementMaps,
  resolveSoTarget,
  createBrowserFsCallbacks,
  applyHideRules,
  applyColorOverrides,
} from "@visant/psd-engine";

export type ArtSlot = { smartObject?: string; artBase64: string };

export interface RenderRequest {
  id: number;
  psdPath: string;
  arts: ArtSlot[];
  hideLayers?: string[];
  /** Cor sólida por camada: { [path]: "#rrggbb" }. */
  colors?: Record<string, string>;
}

export interface RenderResponse {
  id: number;
  blob?: Blob;
  error?: string;
}

const createCanvas = (w: number, h: number): OffscreenCanvas =>
  new OffscreenCanvas(w, h);

agPsd.initializeCanvas(createCanvas as any);

// PSD binary cache: keyed by psdPath to avoid re-fetching on crop/zoom changes.
const psdCache = new Map<string, ArrayBuffer>();

const psdFetcher = async (path: string): Promise<ArrayBuffer> => {
  const r = await fetch(`/api/psd-binary?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error(`psd-binary ${r.status}: ${path}`);
  return r.arrayBuffer();
};

const browserFs = createBrowserFsCallbacks(psdFetcher);

// Tracks the id of the latest request so stale renders can be cancelled.
let currentId = -1;

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  const { id, psdPath, arts, hideLayers = [], colors } = e.data;
  currentId = id;

  try {
    // Fetch PSD once; reuse cached buffer for subsequent crop/zoom previews.
    let psdBuffer = psdCache.get(psdPath);
    if (!psdBuffer) {
      psdBuffer = await psdFetcher(psdPath);
      psdCache.set(psdPath, psdBuffer);
    }
    if (currentId !== id) return; // cancelled while fetching

    const psd = agPsd.readPsd(psdBuffer, { skipThumbnail: true });
    const allLayers = flattenLayers((psd as any).children ?? []);

    // Cor sólida ANTES de compor — a prévia precisa mostrar a mesma coisa que o
    // render final, senão o usuário escolhe a cor num lugar e descobre no outro.
    if (colors && Object.keys(colors).length) {
      applyColorOverrides(allLayers, colors, createCanvas as any);
    }

    await preloadDisplacementMaps(
      allLayers,
      psdPath,
      createCanvas as any,
      browserFs,
      (buf: ArrayBufferLike, opts?: any) => agPsd.readPsd(buf as any, opts),
    );
    if (currentId !== id) return;

    const replacedNames = new Set<string>();
    for (const { smartObject, artBase64 } of arts) {
      if (currentId !== id) return;

      const target = resolveSoTarget(allLayers, smartObject ?? "Your design");
      if (!target) continue;

      const res = await fetch(artBase64);
      const blob = await res.blob();
      const artImg = await createImageBitmap(blob);

      const replaced = replaceLinkedSmartObjects(
        allLayers,
        target,
        artImg as any,
        createCanvas as any,
      );
      for (const r of replaced) replacedNames.add(r.name);
    }

    if (currentId !== id) return;

    // Hide brand placeholder and user-toggled layers (engine SSOT).
    applyHideRules(allLayers, replacedNames, hideLayers);

    const canvas = composePsd(psd as any, createCanvas as any);
    if (currentId !== id) return;

    const resultBlob = await (canvas as OffscreenCanvas).convertToBlob({
      type: "image/jpeg",
      quality: 0.85,
    });

    const reply: RenderResponse = { id, blob: resultBlob };
    (self as any).postMessage(reply);
  } catch (err: any) {
    if (currentId === id) {
      const reply: RenderResponse = { id, error: err?.message ?? String(err) };
      (self as any).postMessage(reply);
    }
  }
};
