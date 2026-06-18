"use client";

/**
 * CanvasContextChip — rótulo discreto no topo do canvas dizendo QUAL modo está ativo
 * (ícone + nome + contexto). Anthropic-like: sutil, comunicativo, só nos modos de
 * edição (no Render some — o canvas já é o resultado). Mata a dúvida "o que estou
 * vendo / editando agora".
 */
import type { LucideIcon } from "lucide-react";

export function CanvasContextChip({
  icon: Icon,
  label,
  sublabel,
  tone = "acc2",
}: {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  tone?: "acc2" | "acc" | "violet" | "amber";
}) {
  const toneCls =
    tone === "violet" ? "text-violet-300"
    : tone === "amber" ? "text-amber-300"
    : tone === "acc" ? "text-acc"
    : "text-acc2";
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-sm border border-zinc-700/50 px-2.5 py-1 text-[11px] text-zinc-200 select-none pointer-events-none shadow-lg">
      <Icon size={12} className={toneCls} />
      <span className="font-medium">{label}</span>
      {sublabel && (
        <>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">{sublabel}</span>
        </>
      )}
    </div>
  );
}
