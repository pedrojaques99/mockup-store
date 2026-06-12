import { readPsd } from "ag-psd";
import { readFileSync, statSync } from "fs";
import { basename } from "path";
import { BRAND_HIDE, flattenLayers } from "@visant/psd-engine";

// flattenLayers vem do pacote SSoT; re-exporta p/ consumidores (e o teste deste módulo).
export { flattenLayers };

// Extensões de imagem aceitas no walk de filesystem — específico do mockup-store (scan
// de pasta), não do engine de compose. Por isso fica aqui, não no pacote.
export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export interface SmartObjectMeta {
  name: string;
  path: string;
  innerWidth: number;
  innerHeight: number;
  layerLeft: number;
  layerTop: number;
  layerRight: number;
  layerBottom: number;
  hasTransform: boolean;
  hasPerspective: boolean;
  /** placedLayer.id — SOs vinculados (mesmo conteúdo embutido) compartilham o id. */
  linkId?: string;
  hidden?: boolean;
}

export interface AdjustmentMeta {
  name: string;
  path: string;
  type: string;
  hidden: boolean;
  data: Record<string, unknown>;
}

export interface PsdMetadata {
  fileName: string;
  filePath: string;
  folder: string;
  sizeBytes: number;
  width: number;
  height: number;
  smartObjects: SmartObjectMeta[];
  adjustments: AdjustmentMeta[];
  scannedAt: Date;
}

function arraysClose(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) < 0.01);
}

export function scanPsd(filePath: string): PsdMetadata | null {
  try {
    const buf = readFileSync(filePath);
    const psd = readPsd(new Uint8Array(buf).buffer, {
      skipThumbnail: true,
      skipLinkedFilesData: true,
      skipLayerImageData: true,
      skipCompositeImageData: true,
    });

    const all = flattenLayers(psd.children || []);

    const smartObjects: SmartObjectMeta[] = all
      .filter((l) => l.placedLayer && !BRAND_HIDE.test(l.name || ""))
      .map((l) => {
        const pl = l.placedLayer;
        const transform = pl.transform || [];
        const nonAffine = pl.nonAffineTransform || [];
        return {
          name: l.name || "unnamed",
          path: l.path,
          innerWidth: pl.width || (l.right - l.left),
          innerHeight: pl.height || (l.bottom - l.top),
          layerLeft: l.left || 0,
          layerTop: l.top || 0,
          layerRight: l.right || 0,
          layerBottom: l.bottom || 0,
          hasTransform: transform.length > 0,
          hasPerspective: nonAffine.length > 0 && !arraysClose(transform, nonAffine),
          linkId: pl.id || undefined,
          hidden: !!l.hidden,
        };
      });

    const adjustments: AdjustmentMeta[] = all
      .filter((l) => l.adjustment)
      .map((l) => ({
        name: l.name || "unnamed",
        path: l.path,
        type: l.adjustment.type || "unknown",
        hidden: !!l.hidden,
        data: l.adjustment,
      }));

    const stat = statSync(filePath);
    const normalized = filePath.replace(/\\/g, "/");

    return {
      fileName: basename(filePath, ".psd"),
      filePath: normalized,
      folder: normalized.split("/").slice(-2, -1)[0] || "",
      sizeBytes: stat.size,
      width: psd.width,
      height: psd.height,
      smartObjects,
      adjustments,
      scannedAt: new Date(),
    };
  } catch {
    return null;
  }
}
