"use client";

/**
 * SegmentCanvas — click-to-segment over the scene photo using SAM2.
 * Left click = include (true), right click = exclude (false). Live mask overlay.
 * Outputs alpha-mask PNG data URLs for "surface" and "occluder" roles.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, MousePointerClick, Trash2, CheckCircle2, Plus, Minus } from "lucide-react";
import { Sam2Client, type DecodedMask } from "@/lib/sam2/client";
import { maskToImageData, maskToAlphaCanvas } from "@/lib/sam2/imageutils";
import type { SamPoint } from "@/lib/sam2/SAM2";

type Role = "surface" | "occluder";

export default function SegmentCanvas({
  imageUrl, imageW, imageH, onApply,
}: {
  imageUrl: string;
  imageW: number;
  imageH: number;
  onApply: (role: Role, maskDataUrl: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<Sam2Client | null>(null);

  const [status, setStatus] = useState<"loading" | "encoding" | "ready" | "error">("loading");
  const [statusMsg, setStatusMsg] = useState("Carregando modelo…");
  const [device, setDevice] = useState<string | null>(null);
  const [points, setPoints] = useState<SamPoint[]>([]);
  const [mask, setMask] = useState<DecodedMask | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<{ surface?: boolean; occluder?: boolean }>({});

  // Boot: download model → session → encode the scene
  useEffect(() => {
    let cancelled = false;
    const client = new Sam2Client();
    clientRef.current = client;
    client.onProgress = (stage) =>
      setStatusMsg(stage === "download" ? "Baixando modelo SAM2 (1ª vez ~100MB)…" : "Iniciando sessão…");

    (async () => {
      try {
        const { device } = await client.init();
        if (cancelled) return;
        setDevice(device);
        setStatus("encoding"); setStatusMsg("Analisando a cena…");
        const img = imgRef.current!;
        if (!img.complete) await new Promise((r) => (img.onload = r));
        await client.encode(img);
        if (cancelled) return;
        setStatus("ready");
      } catch (e: any) {
        if (!cancelled) { setStatus("error"); setStatusMsg(e?.message ?? "Falha ao carregar SAM2"); }
      }
    })();

    return () => { cancelled = true; client.dispose(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Draw overlay: mask + point markers
  const draw = useCallback(() => {
    const canvas = overlayRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    const r = img.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);

    if (mask) {
      const off = document.createElement("canvas");
      off.width = mask.width; off.height = mask.height;
      off.getContext("2d")!.putImageData(maskToImageData(mask.mask, mask.width, mask.height), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, w, h);
    }

    const sx = w / imageW, sy = h / imageH;
    for (const p of points) {
      const cx = p.x * sx, cy = p.y * sy;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = p.label === 1 ? "#22c55e" : "#ef4444";
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    }
  }, [mask, points, imageW, imageH]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const runDecode = useCallback(async (pts: SamPoint[]) => {
    if (status !== "ready" || pts.length === 0) { setMask(null); return; }
    setBusy(true);
    try {
      const res = await clientRef.current!.decode(pts, imageW, imageH);
      setMask(res);
    } catch { /* ignore single-click failure */ }
    setBusy(false);
  }, [status, imageW, imageH]);

  const addPoint = (e: React.MouseEvent, label: 0 | 1) => {
    if (status !== "ready") return;
    e.preventDefault();
    const img = imgRef.current!;
    const r = img.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * imageW;
    const y = ((e.clientY - r.top) / r.height) * imageH;
    const next = [...points, { x, y, label }];
    setPoints(next);
    runDecode(next);
  };

  const clearPoints = () => { setPoints([]); setMask(null); };

  const apply = (role: Role) => {
    if (!mask) return;
    // Mask logits → alpha canvas at decoder res → upscale to original image size → PNG
    const small = maskToAlphaCanvas(mask.mask, mask.width, mask.height);
    const full = document.createElement("canvas");
    full.width = imageW; full.height = imageH;
    full.getContext("2d")!.drawImage(small, 0, 0, imageW, imageH);
    onApply(role, full.toDataURL("image/png"));
    setApplied((a) => ({ ...a, [role]: true }));
  };

  return (
    <div className="space-y-2">
      <div ref={wrapRef} className="relative select-none rounded-xl overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="scene"
          draggable={false}
          className="w-full block"
          onClick={(e) => addPoint(e, 1)}
          onContextMenu={(e) => addPoint(e, 0)}
        />
        <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />

        {/* Status veil */}
        {status !== "ready" && (
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-center px-6">
            {status === "error"
              ? <p className="text-red-400 text-sm">{statusMsg}</p>
              : <><Loader2 size={24} className="animate-spin text-indigo-400" /><p className="text-zinc-300 text-sm">{statusMsg}</p></>}
          </div>
        )}
        {busy && status === "ready" && (
          <div className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5"><Loader2 size={12} className="animate-spin text-indigo-300" /></div>
        )}
      </div>

      {/* Legend + controls */}
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span className="flex items-center gap-2">
          <MousePointerClick size={11} />
          <span className="flex items-center gap-1"><Plus size={9} className="text-green-500" />clique = incluir</span>
          <span className="flex items-center gap-1"><Minus size={9} className="text-red-500" />direito = excluir</span>
          {device && <span className="font-mono text-zinc-700 ml-1">{device}</span>}
        </span>
        <button onClick={clearPoints} disabled={!points.length}
          className="flex items-center gap-1 hover:text-zinc-300 disabled:opacity-40 transition-colors">
          <Trash2 size={11} /> Limpar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => apply("surface")} disabled={!mask}
          className={["py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors",
            applied.surface ? "bg-green-700 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"].join(" ")}>
          {applied.surface ? <><CheckCircle2 size={12} /> Superfície ✓</> : "Usar como superfície"}
        </button>
        <button onClick={() => apply("occluder")} disabled={!mask}
          className={["py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors",
            applied.occluder ? "bg-amber-700 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"].join(" ")}>
          {applied.occluder ? <><CheckCircle2 size={12} /> Oclusão ✓</> : "Usar como oclusão"}
        </button>
      </div>
    </div>
  );
}
