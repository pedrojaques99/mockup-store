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
import { useRef, useState, useCallback, useEffect } from "react";
import { Pen, Brush, Wand2, Pipette, Eraser, RotateCcw, Plus, Minus, Eye, EyeOff } from "lucide-react";
import PenMaskCanvas, { type PenApi } from "@/components/PenMaskCanvas";
import BrushCanvas, { type BrushApi } from "@/components/BrushCanvas";
import SegmentCanvas, { type SegApi, type SegMode } from "@/components/SegmentCanvas";
import { compositeMask, invertMask, capMaskDims } from "@/lib/mask-compose";

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

  // Fila serializada — mesma disciplina do useMaskEditor (photo-mockup). Sem ela, dois
  // traços rápidos liam a MESMA base (o `mask` congelado no closure) e o segundo a
  // sobrescrevia: o primeiro traço simplesmente sumia da tela — lost update, e o usuário
  // só percebia depois. Aqui cada escrita espera a anterior COMMITAR, e a base vem do
  // `maskRef` (o valor recém-produzido), não do prop, que só volta pelo React no próximo
  // render.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((fn: () => Promise<void> | void) => {
    const next = queueRef.current.then(fn, fn);
    queueRef.current = next.then(() => {}, () => {}); // nunca rejeita → fila não trava
  }, []);

  // Espelho da máscara commitada. `echoRef` guarda o último valor que NÓS emitimos:
  // enquanto o prop não alcança esse valor, toda mudança que chega é eco atrasado do
  // nosso próprio write e adotá-la ressuscitaria uma base velha. Alcançou (ou nunca
  // emitimos), o prop manda — é assim que trocar de cena/carregar máscara do disco entra.
  const maskRef = useRef<string | null>(mask);
  const echoRef = useRef<{ v: string | null } | null>(null);
  useEffect(() => {
    if (!echoRef.current) { maskRef.current = mask; return; }
    if (mask === echoRef.current.v) echoRef.current = null;
  }, [mask]);

  const commit = useCallback((next: string | null) => {
    maskRef.current = next;
    echoRef.current = { v: next };
    onMaskChange(next);
  }, [onMaskChange]);

  const composite = useCallback((patchUrl: string) => {
    enqueue(async () => {
      commit(await compositeMask(maskRef.current, patchUrl, mode, maskW, maskH));
    });
  }, [mode, maskW, maskH, enqueue, commit]);

  const handleApply = useCallback((_role: "surface" | "occluder", patchUrl: string) => {
    composite(patchUrl);
  }, [composite]);

  const handleBrushChange = useCallback((patchUrl: string | null) => {
    if (patchUrl) composite(patchUrl);
  }, [composite]);

  const clearMask = useCallback(() => {
    enqueue(() => { commit(null); });
    penRef.current?.clear?.(); brushRef.current?.clear?.(); segRef.current?.clear?.();
  }, [enqueue, commit]);

  /* Inverter age sobre máscara que EXISTE — é o modelo do Photoshop, que este lib
   * já diz seguir no cabeçalho: lá o Ctrl+I transforma a máscara, e CRIAR máscara é
   * outro ato, com dois nomes próprios (Reveal All branca, Hide All preta). O
   * Photoshop nunca sobrecarrega o Inverter para significar "cria uma cheia".
   *
   * Aqui o botão vivia sempre ligado e, sem máscara, cobria tudo de branco — a
   * mesma tecla fazendo duas coisas conforme um estado que o usuário não vê. O
   * irmão `MaskPanel` já estava certo (`disabled={!p.hasTargetMask}`); esta era a
   * ponta divergente, e o controle passa a desligar igual. */
  const invert = useCallback(() => {
    enqueue(async () => {
      const cur = maskRef.current;
      if (!cur) return;
      commit(await invertMask(cur, maskW, maskH));
    });
  }, [maskW, maskH, enqueue, commit]);

  return (
    <div className="absolute inset-0 flex flex-col bg-zinc-950">
      {/* toolbar mask */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800 text-xs flex-wrap">
        <div className="flex items-center gap-0.5 bg-zinc-900 rounded-lg p-0.5">
          {INSTRUMENTS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setInstr(id)} title={label}
              className={["flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-ui", instr === id ? "bg-acc2 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 bg-zinc-900 rounded-lg p-0.5">
          <button onClick={() => setMode("add")} title="Somar (Shift = +)" className={["flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-ui", mode === "add" ? "bg-acc2 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"].join(" ")}><Plus size={12} /></button>
          <button onClick={() => setMode("sub")} title="Subtrair (Alt = −)" className={["flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-ui", mode === "sub" ? "bg-red-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}><Minus size={12} /></button>
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
          <button onClick={() => penRef.current?.apply?.("surface")} className="px-2 py-1 rounded bg-acc2 hover:bg-acc2/90 text-zinc-950">Aplicar caneta</button>
        )}
        {(instr === "wand" || instr === "sam") && (
          <button onClick={() => segRef.current?.apply?.("surface")} className="px-2 py-1 rounded bg-acc2 hover:bg-acc2/90 text-zinc-950">Aplicar seleção</button>
        )}
        <button onClick={invert} disabled={!mask} title="Inverter máscara" className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30 disabled:hover:bg-zinc-800">Inverter</button>
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
