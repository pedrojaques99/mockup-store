"use client";

import { Check } from "lucide-react";

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
function ratioLabel(w: number, h: number): string {
  if (!w || !h) return "";
  const g = gcd(w, h) || 1;
  const rw = w / g, rh = h / g;
  // Razões "redondas" mostram como i:j; senão decimal.
  return rw <= 32 && rh <= 32 ? `${rw}:${rh}` : (w / h).toFixed(2);
}

/** CornersPanel — geometry of the surface quad (handles live on the canvas overlay). */
export function CornersPanel({ onConfirm, size }: { onConfirm?: () => void; size?: { w: number; h: number } }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-zinc-600">
        Arraste os cantos pra ajustar a superfície; losangos curvam as bordas.
        Duplo-clique num canto encaixa na borda da imagem · Enter vai pro render.
      </p>
      {size && size.w > 0 && size.h > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-zinc-900/50 border border-zinc-800/60 px-2 py-1.5 font-mono text-[10px]">
          <span className="text-zinc-300">{size.w}×{size.h}px</span>
          <span className="text-acc2">{ratioLabel(size.w, size.h)}</span>
        </div>
      )}
      {onConfirm && (
        <button
          onClick={onConfirm}
          className="w-full py-2 rounded-xl text-xs font-medium bg-acc2 text-zinc-950 hover:bg-acc2/90 transition-colors flex items-center justify-center gap-1.5"
        >
          <Check size={12} /> OK · ir pro render
        </button>
      )}
    </div>
  );
}
