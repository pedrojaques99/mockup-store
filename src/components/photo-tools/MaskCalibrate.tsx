"use client";

/**
 * MaskCalibrate — mask editor completo pro /calibrate, reusando os 4 instrumentos
 * já validados do photo-mockup (Pen, Brush, Wand/Smart, SAM2 on-device) + color
 * picker via SegmentCanvas mode "smart" (flood fill por cor com tolerância).
 *
 * Composição add/subtract via mask-compose (mesma fila serializada do editor).
 * SSoT: a máscara final viaja como PNG data URL pro /api/calibrate/save, que
 * grava sidecar `<name>.mask.png` referenciado em `QuadEntry.surfaceMaskRel`.
 */
import { useRef, useState, useCallback } from "react";
import { Pen, Brush, Wand2, Pipette, Eraser, RotateCcw, Plus, Minus, Eye, EyeOff } from "lucide-react";
import PenMaskCanvas, { type PenApi } from "@/components/PenMaskCanvas";
import BrushCanvas, { type BrushApi } from "@/components/BrushCanvas";
import SegmentCanvas, { type SegApi, type SegMode } from "@/components/SegmentCanvas";
import { compositeMask, capMaskDims } from "@/lib/mask-compose";

type Instrument = "pen" | "brush" | "wand" | "sam";

const INSTRUMENTS: { id: Instrument; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "pen", label: "Caneta", icon: Pen },
  { id: "brush", label: "Pincel", icon: Brush },
  { id: "wand", label: "Conta-gotas", icon: Pipette }, // smart = magic wand (color picker + flood)
  { id: "sam", label: "SAM", icon: Wand2 },
];

export function MaskCalibrate({
  imageUrl, imageW, imageH, mask, onMaskChange,
}: {
  imageUrl: string; imageW: number; imageH: number;
  mask: string | null; onMaskChange: (m: string | null) => void;
}) {
  const [instr, setInstr] = useState<Instrument>("pen");
  const [mode, setMode] = useState<"add" | "sub">("add");
  const [brush, setBrush] = useState(40);
  const [feather, setFeather] = useState(2);
  const [tol, setTol] = useState(24);
  const [contract, setContract] = useState(1);
  const [showMask, setShowMask] = useState(true);
  const penRef = useRef<PenApi | null>(null);
  const brushRef = useRef<BrushApi | null>(null);
  const segRef = useRef<SegApi | null>(null);

  const segMode: SegMode = instr === "sam" ? "sam" : "smart";

  const [maskW, maskH] = capMaskDims(imageW, imageH);

  const composite = useCallback(async (patchUrl: string) => {
    const next = await compositeMask(mask, patchUrl, mode, maskW, maskH);
    onMaskChange(next);
  }, [mask, mode, maskW, maskH, onMaskChange]);

  const handleApply = useCallback((_role: "surface" | "occluder", patchUrl: string) => {
    composite(patchUrl);
  }, [composite]);

  const handleBrushChange = useCallback((patchUrl: string | null) => {
    if (patchUrl) composite(patchUrl);
  }, [composite]);

  const clearMask = () => { onMaskChange(null); penRef.current?.clear?.(); brushRef.current?.clear?.(); segRef.current?.clear?.(); };
  const invert = useCallback(async () => {
    if (!mask) {
      // sem mask → "invertido" = tudo branco
      const cv = document.createElement("canvas"); cv.width = maskW; cv.height = maskH;
      const ctx = cv.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, maskW, maskH);
      onMaskChange(cv.toDataURL("image/png")); return;
    }
    const cv = document.createElement("canvas"); cv.width = maskW; cv.height = maskH;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, maskW, maskH);
    ctx.globalCompositeOperation = "destination-out";
    const img = new Image(); img.src = mask;
    await new Promise<void>((res) => { img.onload = () => res(); });
    ctx.drawImage(img, 0, 0, maskW, maskH);
    onMaskChange(cv.toDataURL("image/png"));
  }, [mask, maskW, maskH, onMaskChange]);

  return (
    <div className="absolute inset-0 flex flex-col bg-zinc-950">
      {/* toolbar mask */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800 text-xs flex-wrap">
        <div className="flex items-center gap-0.5 bg-zinc-900 rounded-lg p-0.5">
          {INSTRUMENTS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setInstr(id)} title={label}
              className={["flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors", instr === id ? "bg-cyan-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 bg-zinc-900 rounded-lg p-0.5">
          <button onClick={() => setMode("add")} title="Somar (Shift = +)" className={["flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors", mode === "add" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}><Plus size={12} /></button>
          <button onClick={() => setMode("sub")} title="Subtrair (Alt = −)" className={["flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors", mode === "sub" ? "bg-red-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}><Minus size={12} /></button>
        </div>

        {instr === "brush" && (
          <label className="flex items-center gap-2 text-zinc-400">tamanho
            <input type="range" min={4} max={200} step={2} value={brush} onChange={(e) => setBrush(+e.target.value)} />
            <span className="font-mono text-zinc-300 w-8">{brush}</span>
          </label>
        )}
        {instr === "pen" && (
          <label className="flex items-center gap-2 text-zinc-400">feather
            <input type="range" min={0} max={10} step={1} value={feather} onChange={(e) => setFeather(+e.target.value)} />
            <span className="font-mono text-zinc-300 w-6">{feather}</span>
          </label>
        )}
        {instr === "wand" && (<>
          <label className="flex items-center gap-2 text-zinc-400">tolerância
            <input type="range" min={1} max={120} step={1} value={tol} onChange={(e) => setTol(+e.target.value)} />
            <span className="font-mono text-zinc-300 w-6">{tol}</span>
          </label>
          <label className="flex items-center gap-2 text-zinc-400">contract
            <input type="range" min={0} max={8} step={1} value={contract} onChange={(e) => setContract(+e.target.value)} />
            <span className="font-mono text-zinc-300 w-4">{contract}</span>
          </label>
          <label className="flex items-center gap-2 text-zinc-400">feather
            <input type="range" min={0} max={8} step={1} value={feather} onChange={(e) => setFeather(+e.target.value)} />
            <span className="font-mono text-zinc-300 w-4">{feather}</span>
          </label>
        </>)}

        <div className="flex-1" />

        {(instr === "pen") && (
          <button onClick={() => penRef.current?.apply?.("surface")} className="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white">Aplicar caneta</button>
        )}
        {(instr === "wand" || instr === "sam") && (
          <button onClick={() => segRef.current?.apply?.("surface")} className="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white">Aplicar seleção</button>
        )}
        <button onClick={invert} title="Inverter máscara" className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">Inverter</button>
        <button onClick={clearMask} title="Limpar tudo" className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><Eraser size={13} /></button>
        <button onClick={() => setShowMask((v) => !v)} title="Mostrar/ocultar máscara" className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">{showMask ? <Eye size={13} /> : <EyeOff size={13} />}</button>
      </div>

      {/* viewer */}
      <div className="flex-1 min-h-0 relative overflow-auto flex items-center justify-center">
        <div className="relative" style={{ maxWidth: "100%", maxHeight: "100%" }}>
          {instr === "pen" && (
            <PenMaskCanvas imageUrl={imageUrl} imageW={imageW} imageH={imageH}
              onApply={handleApply} feather={feather} apiRef={penRef} />
          )}
          {instr === "brush" && (
            <BrushCanvas imageUrl={imageUrl} imageW={imageW} imageH={imageH}
              brush={brush} eraseMode={mode === "sub"} onChange={handleBrushChange} apiRef={brushRef} patchMode />
          )}
          {(instr === "wand" || instr === "sam") && (
            <SegmentCanvas imageUrl={imageUrl} imageW={imageW} imageH={imageH}
              mode={segMode} tolerance={tol} contract={contract} matte={false} feather={feather}
              onApply={handleApply} apiRef={segRef} />
          )}

          {/* overlay da máscara persistente (verde semitransparente) */}
          {showMask && mask && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mask} alt="" className="absolute inset-0 pointer-events-none mix-blend-screen opacity-60"
              style={{ width: "100%", height: "100%", filter: "hue-rotate(80deg) saturate(2)" }} />
          )}
        </div>
      </div>
    </div>
  );
}
