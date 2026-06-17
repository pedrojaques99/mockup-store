"use client";

/**
 * ArtFramePanel — shared fit-mode + crop UI for artwork placement.
 * Single source of truth used by both the Mockup Store and the Scene Maker.
 * All framing math lives in @/lib/art-frame; this is purely the control surface.
 */
import { useEffect, useState } from "react";
import { Crop, Minimize2, Maximize2, X, AlertTriangle } from "lucide-react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import {
  type FrameConfig,
  coverCrop,
  isLowRes,
} from "@/lib/art-frame";

export interface ArtFramePanelProps {
  artPreview: string;
  artDims: { width: number; height: number } | null;
  frame: FrameConfig;
  onFrameChange: (updater: FrameConfig | ((f: FrameConfig) => FrameConfig)) => void;
  /** Target surface inner size — drives crop aspect + low-res warning. */
  soWidth?: number;
  soHeight?: number;
  fileName?: string;
  onClear?: () => void;
  /** Tailwind height class for the preview/cropper area. */
  previewHeightClass?: string;
  /** Compact mode shrinks the type scale for the floating panel. */
  compact?: boolean;
}

export default function ArtFramePanel({
  artPreview,
  artDims,
  frame,
  onFrameChange,
  soWidth,
  soHeight,
  fileName,
  onClear,
  previewHeightClass = "h-44",
  compact = false,
}: ArtFramePanelProps) {
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);

  // Reset cropper when a new image loads
  useEffect(() => {
    setCropPos({ x: 0, y: 0 });
    setCropZoom(1);
  }, [artPreview]);

  const aspect = soWidth && soHeight ? soWidth / soHeight : 16 / 9;

  const lowRes = (() => {
    if (!artDims || !soWidth || !soHeight) return false;
    const src =
      frame.mode === "cover"
        ? frame.cropPixels ?? coverCrop(artDims.width, artDims.height, soWidth, soHeight)
        : { width: artDims.width, height: artDims.height };
    return isLowRes(src.width, src.height, soWidth, soHeight);
  })();

  const setMode = (mode: FrameConfig["mode"]) => {
    if (mode === "cover") {
      setCropPos({ x: 0, y: 0 });
      setCropZoom(1);
      onFrameChange((f) => ({ ...f, mode: "cover", cropPixels: undefined }));
    } else {
      onFrameChange((f) => ({ ...f, mode }));
    }
  };

  const nameSize = compact ? "text-[11px]" : "text-xs";
  const dimsSize = compact ? "text-[9px]" : "text-[10px]";

  return (
    <div className="flex flex-col gap-2">
      {/* Preview */}
      {frame.mode === "cover" ? (
        <>
          <div className={`relative ${previewHeightClass} w-full overflow-hidden rounded-xl bg-black`}>
            <Cropper
              image={artPreview}
              crop={cropPos}
              zoom={cropZoom}
              aspect={aspect}
              showGrid={false}
              onCropChange={setCropPos}
              onZoomChange={setCropZoom}
              onCropComplete={(_area: Area, px: Area) =>
                onFrameChange((f) => ({ ...f, cropPixels: px }))
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-600 shrink-0">Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={cropZoom}
              onChange={(e) => setCropZoom(Number(e.target.value))}
              className="h-1 flex-1 accent-white"
            />
          </div>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artPreview}
          alt="Art"
          className={`w-full rounded-xl bg-black ${previewHeightClass}`}
          style={{ objectFit: frame.mode === "contain" ? "contain" : "fill" }}
        />
      )}

      {/* Info + mode controls */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className={`${nameSize} font-bold text-white truncate`}>{fileName || "Artwork"}</p>
          {artDims && (
            <p className={`${dimsSize} text-neutral-500`}>
              {artDims.width}×{artDims.height}px
              {soWidth && soHeight ? ` · SO ${Math.round(soWidth)}×${Math.round(soHeight)}` : ""}
            </p>
          )}
        </div>

        {lowRes && (
          <AlertTriangle className="w-4 h-4 text-acc shrink-0" aria-label="Low resolution" />
        )}

        <div className="flex gap-0.5 shrink-0 bg-neutral-950 border border-neutral-800 rounded-lg p-0.5">
          <button
            onClick={() => setMode("cover")}
            className={`p-1.5 rounded-md transition-all ${frame.mode === "cover" ? "bg-white text-black shadow-sm" : "text-neutral-500 hover:text-white"}`}
            title="Cover — preenche cortando"
          >
            <Crop className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMode("contain")}
            className={`p-1.5 rounded-md transition-all ${frame.mode === "contain" ? "bg-white text-black shadow-sm" : "text-neutral-500 hover:text-white"}`}
            title="Fit — arte inteira visível"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMode("stretch")}
            className={`p-1.5 rounded-md transition-all ${frame.mode === "stretch" ? "bg-white text-black shadow-sm" : "text-neutral-500 hover:text-white"}`}
            title="Esticar — distorce para preencher"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {onClear && (
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg text-neutral-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
            title="Remover arte"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
