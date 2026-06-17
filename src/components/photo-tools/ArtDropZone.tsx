"use client";

/** Artwork drop zone (SSoT — used by the Render panel + the full-screen empty state). */
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
  size?: "panel" | "hero";
  className?: string;
  inputId?: string;
}) {
  const hero = size === "hero";
  return (
    <div
      onClick={() => document.getElementById(inputId)?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) onFile(f); }}
      className={[
        "rounded-2xl border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center text-center group",
        hero ? "gap-3 px-12 py-16 w-[min(440px,70vw)]" : "gap-1.5 p-3 h-24",
        dragOver
          ? "border-acc bg-acc/10"
          : "border-zinc-700 hover:border-zinc-500 bg-zinc-900/30 hover:bg-zinc-900/50",
        className,
      ].join(" ")}
    >
      <Upload
        size={hero ? 40 : 20}
        className={dragOver ? "text-acc" : "text-zinc-600 group-hover:text-zinc-400 transition-colors"}
      />
      <p className={[hero ? "text-base" : "text-[10px]", "font-medium transition-colors", dragOver ? "text-acc" : "text-zinc-500 group-hover:text-zinc-300"].join(" ")}>
        {dragOver ? "Solte pra renderizar" : "Solte a arte aqui"}
      </p>
      <p className={[hero ? "text-xs" : "text-[9px]", "text-zinc-700"].join(" ")}>PNG, JPG, SVG · renderiza ao soltar</p>
    </div>
  );
}
