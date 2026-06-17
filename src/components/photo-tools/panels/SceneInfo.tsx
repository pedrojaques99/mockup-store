"use client";

/** SceneInfo — scene thumbnail + surface type + re-detect. Shared across tools. */
import { Zap } from "lucide-react";

export interface SceneInfoProps {
  photoUrl: string | null;
  surfaceType?: string;
  material?: string;
  imgDims: { w: number; h: number };
  onReanalyze: () => void;
  analyzing: boolean;
}

export function SceneInfo({ photoUrl, surfaceType, material, imgDims, onReanalyze, analyzing }: SceneInfoProps) {
  return (
    <div className="flex items-center gap-2 bg-zinc-800/40 rounded-xl p-2.5 border border-zinc-700/30">
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="scene" className="w-12 h-12 object-cover rounded-lg flex-none border border-zinc-700/60" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-zinc-300 truncate capitalize">{surfaceType ?? "Foto"} · {material}</p>
        <p className="text-[9px] text-zinc-600">{imgDims.w}×{imgDims.h}px</p>
        <button onClick={onReanalyze} disabled={analyzing}
          className="text-[9px] text-zinc-500 hover:text-acc flex items-center gap-0.5 transition-colors mt-0.5">
          <Zap size={7} /> Re-detectar superfície
        </button>
      </div>
    </div>
  );
}
