"use client";

/** Artwork drop zone (SSoT — Render panel slot, full-screen hero, e a variante
 *  `quad` que vive DENTRO do smart object e adapta a densidade ao espaço). */
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";

export function ArtDropZone({
  onFile,
  dragOver,
  size = "panel",
  className = "",
  inputId = "art-input-fs",
}: {
  onFile: (f: File) => void;
  dragOver: boolean;
  size?: "panel" | "hero" | "quad";
  className?: string;
  inputId?: string;
}) {
  const open = () => document.getElementById(inputId)?.click();
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) onFile(f); };

  // ── Variante "quad" — preenche a área do smart object e ADAPTA o conteúdo ao
  //    tamanho real (mede via ResizeObserver). Nunca transborda. ──────────────
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (size !== "quad") return;
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [size]);

  if (size === "quad") {
    // Tier por espaço disponível (px). Da densidade máxima ao mínimo clicável.
    const tier = box.h >= 120 && box.w >= 130 ? "full"
      : box.h >= 62 && box.w >= 84 ? "compact"
      : box.h >= 28 ? "mini"
      : "tiny";
    const icon = tier === "full" ? 26 : tier === "compact" ? 20 : 16;
    return (
      <div
        ref={boxRef}
        onClick={open}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        title="Solte ou clique pra adicionar a arte"
        className={[
          "w-full h-full rounded-xl overflow-hidden cursor-pointer flex flex-col items-center justify-center text-center gap-1 px-2 border backdrop-blur-2xl shadow-2xl shadow-black/40 transition-ui group",
          dragOver ? "border-acc bg-acc/10" : "border-white/12 bg-white/[0.06] hover:bg-white/[0.1]",
          className,
        ].join(" ")}
      >
        {tier !== "tiny" && (
          <Upload size={icon} className={dragOver ? "text-acc" : "text-zinc-300 group-hover:text-white transition-ui"} />
        )}
        {(tier === "full" || tier === "compact") && (
          <p className={[tier === "full" ? "text-sm" : "text-[11px]", "font-medium leading-tight transition-ui", dragOver ? "text-acc" : "text-zinc-200 group-hover:text-white"].join(" ")}>
            {dragOver ? "Solte" : tier === "full" ? "Solte a arte aqui" : "Solte a arte"}
          </p>
        )}
        {tier === "full" && (
          <p className="text-[10px] text-zinc-400/80 leading-tight">PNG, JPG, SVG. Renderiza ao soltar</p>
        )}
        {tier === "tiny" && (
          // Espaço minúsculo: só um glow pulsante clicável (texto/ícone não cabem).
          <span className="w-2 h-2 rounded-full bg-acc2 animate-pulse" />
        )}
      </div>
    );
  }

  const hero = size === "hero";
  return (
    <div
      onClick={open}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={[
        "rounded-2xl cursor-pointer transition-ui flex flex-col items-center justify-center text-center group",
        hero
          // Glass panel — compact, frosted, floats over the scene (not a full-screen zone).
          ? ["gap-2.5 px-6 py-7 w-full max-w-[340px] border backdrop-blur-2xl shadow-2xl shadow-black/50",
             dragOver ? "border-acc bg-acc/10" : "border-white/10 bg-white/[0.05] hover:bg-white/[0.08]"].join(" ")
          // Inline drop slot inside the Render panel — keeps the dashed affordance.
          : ["gap-1.5 p-3 h-24 border-2 border-dashed",
             dragOver ? "border-acc bg-acc/10" : "border-zinc-700 hover:border-zinc-500 bg-zinc-900/30 hover:bg-zinc-900/50"].join(" "),
        className,
      ].join(" ")}
    >
      <Upload
        size={hero ? 30 : 20}
        className={dragOver ? "text-acc" : "text-zinc-500 group-hover:text-zinc-300 transition-ui"}
      />
      <p className={[hero ? "text-sm" : "text-[10px]", "font-medium transition-ui", dragOver ? "text-acc" : "text-zinc-300 group-hover:text-white"].join(" ")}>
        {dragOver ? "Solte pra renderizar" : "Solte a arte aqui"}
      </p>
      <p className={[hero ? "text-xs" : "text-[9px]", "text-zinc-700"].join(" ")}>PNG, JPG, SVG. Renderiza ao soltar</p>
    </div>
  );
}
