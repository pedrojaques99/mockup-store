"use client";

/**
 * ExportBar — salva a imagem renderizada em PNG/JPEG/WebP com qualidade ajustável.
 * Conversão client-side via canvas.toBlob (src é blob:/same-origin → sem taint).
 * Substitui o antigo "Salvar PNG". Reusa Segmented do design system.
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Segmented } from "@/components/ui/Segmented";

type Fmt = "png" | "jpeg" | "webp";

export function ExportBar({ src }: { src: string | null }) {
  const [fmt, setFmt] = useState<Fmt>("png");
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = () => rej(new Error(`Não carregou a imagem para exportar: ${src}`));
        im.src = src;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      if (fmt !== "png") {
        ctx.fillStyle = "#ffffff"; // achata transparência para formatos lossy
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((res) =>
        c.toBlob(res, `image/${fmt}`, fmt === "png" ? undefined : quality / 100),
      );
      if (!blob) throw new Error("conversão falhou");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mockup.${fmt}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      // Este é o passo final do produto (download do mockup) — nunca pode falhar em
      // silêncio. canvas "tainted" (CORS) ou toBlob retornando null viram um botão
      // que só volta do estado busy, indistinguível de sucesso. Avisa e loga a causa real.
      console.error("[ExportBar] falha ao exportar imagem", e);
      toast.error("Não foi possível salvar a imagem. Tente novamente ou escolha outro formato (PNG/JPEG/WebP).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Segmented<Fmt>
        value={fmt}
        onChange={setFmt}
        options={[
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
          { value: "webp", label: "WebP" },
        ]}
      />
      {fmt !== "png" && (
        <label className="text-[10px] text-zinc-400 flex items-center justify-between gap-2">
          <span>Qualidade</span>
          <input
            type="range"
            min={40}
            max={100}
            step={1}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="flex-1 h-1 accent-acc"
          />
          <span className="font-mono text-zinc-500 w-8 text-right">{quality}%</span>
        </label>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!src || busy}
        className="w-full py-2 rounded-xl text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors bg-acc2 hover:bg-acc2/90 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        {busy ? <><Loader2 size={11} className="animate-spin" /> Salvando…</> : <><Download size={11} /> Salvar {fmt.toUpperCase()}</>}
      </button>
    </div>
  );
}
