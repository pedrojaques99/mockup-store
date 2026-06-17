"use client";

/**
 * SegmentCanvas — the CANVAS ONLY (image + interaction + mask overlay). All tool
 * options (mode, tolerance, clean/contract, matte, feather, apply) live in the
 * side panel (Photoshop-style) and are passed in as controlled props. The page
 * triggers apply/clear via `apiRef`; the component reports mask/status back.
 *   • SAM   — left click = include, right click = exclude (SAM2, semantic).
 *   • Smart — magic-wand flood fill: contiguous color select + contract erode +
 *             guided-filter matte + feather on apply.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import MagicWand from "magic-wand-tool";
import { refineAlphaGuided } from "@/lib/guided-filter";
import { Sam2Client, type DecodedMask } from "@/lib/sam2/client";
import { maskToImageData, maskToAlphaCanvas } from "@/lib/sam2/imageutils";
import type { SamPoint } from "@/lib/sam2/SAM2";

type Role = "surface" | "occluder";
export type SegMode = "sam" | "smart";
export type SegApi = { apply: (r: Role) => void; clear: () => void };

export default function SegmentCanvas({
  imageUrl, sampleUrl, imageW, imageH, onApply,
  mode, tolerance, contract, matte, feather,
  onMaskChange, onStatusChange, onSwatch, apiRef,
}: {
  imageUrl: string;
  sampleUrl?: string;
  imageW: number;
  imageH: number;
  onApply: (role: Role, maskDataUrl: string) => void;
  mode: SegMode;
  tolerance: number;
  contract: number;
  matte: boolean;
  feather: number;
  onMaskChange?: (hasMask: boolean) => void;
  onStatusChange?: (s: { status: string; msg: string; device: string | null }) => void;
  onSwatch?: (rgb: [number, number, number] | null) => void;
  apiRef?: React.MutableRefObject<SegApi | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const sampleImgRef = useRef<HTMLImageElement>(null);
  const sampleSrc = sampleUrl && sampleUrl !== imageUrl ? sampleUrl : null;
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<Sam2Client | null>(null);

  const samplePixels = useRef<Uint8ClampedArray | null>(null);
  const smartAlphaRef = useRef<Uint8Array | null>(null);
  const smartOverlayRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<"loading" | "encoding" | "ready" | "error">("loading");
  const [statusMsg, setStatusMsg] = useState("Carregando modelo…");
  const [device, setDevice] = useState<string | null>(null);
  const [points, setPoints] = useState<SamPoint[]>([]);
  const [mask, setMask] = useState<DecodedMask | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<[number, number] | null>(null);
  const [ver, setVer] = useState(0);
  const dragPt = useRef<{ idx: number; moved: boolean } | null>(null);  // SAM point being dragged
  const pointsRef = useRef<SamPoint[]>([]);

  // Boot SAM2 → encode the SAMPLE source (scene), not the displayed render.
  useEffect(() => {
    let cancelled = false;
    const client = new Sam2Client();
    clientRef.current = client;
    client.onProgress = (stage) =>
      setStatusMsg(stage === "download" ? "Baixando SAM2 (1ª vez ~100MB)…" : "Iniciando sessão…");
    (async () => {
      try {
        const { device } = await client.init();
        if (cancelled) return;
        setDevice(device);
        setStatus("encoding"); setStatusMsg("Analisando a cena…");
        const img = (sampleSrc ? sampleImgRef.current : imgRef.current)!;
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
  }, [sampleSrc ?? imageUrl]);

  const ensureSample = useCallback(() => {
    if (samplePixels.current) return;
    const img = sampleSrc ? sampleImgRef.current : imgRef.current;
    if (!img || !img.complete) return;
    const c = document.createElement("canvas");
    c.width = imageW; c.height = imageH;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, imageW, imageH);
    samplePixels.current = ctx.getImageData(0, 0, imageW, imageH).data;
  }, [imageW, imageH, sampleSrc]);

  const computeSmartMask = useCallback(() => {
    const px = samplePixels.current;
    if (!px || !seed) { smartAlphaRef.current = null; smartOverlayRef.current = null; setVer(v => v + 1); return; }
    const m = MagicWand.floodFill({ data: px, width: imageW, height: imageH, bytes: 4 }, seed[0], seed[1], tolerance, null, false);
    if (!m) { smartAlphaRef.current = null; smartOverlayRef.current = null; setVer(v => v + 1); return; }
    const data = m.data;
    for (let it = 0; it < contract; it++) {
      const src = data.slice();
      for (let y = 0; y < imageH; y++) for (let x = 0; x < imageW; x++) {
        const i = y * imageW + x;
        if (!src[i]) continue;
        if ((x > 0 && !src[i - 1]) || (x < imageW - 1 && !src[i + 1]) ||
            (y > 0 && !src[i - imageW]) || (y < imageH - 1 && !src[i + imageW])) data[i] = 0;
      }
    }
    const n = imageW * imageH;
    const alpha = new Uint8Array(n);
    const overlay = document.createElement("canvas");
    overlay.width = imageW; overlay.height = imageH;
    const octx = overlay.getContext("2d")!;
    const oimg = octx.createImageData(imageW, imageH);
    const od = oimg.data;
    for (let i = 0; i < n; i++) if (data[i]) { alpha[i] = 255; const j = i * 4; od[j] = 34; od[j + 1] = 211; od[j + 2] = 238; od[j + 3] = 130; }
    octx.putImageData(oimg, 0, 0);
    smartAlphaRef.current = alpha;
    smartOverlayRef.current = overlay;
    setVer(v => v + 1);
  }, [seed, tolerance, contract, imageW, imageH]);

  useEffect(() => {
    if (mode !== "smart") return;
    const t = setTimeout(() => computeSmartMask(), 90);
    return () => clearTimeout(t);
  }, [mode, seed, tolerance, contract]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(() => {
    const canvas = overlayRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    // LAYOUT size (offset*), not getBoundingClientRect — so the overlay scales WITH
    // the ZoomPanViewer transform instead of double-scaling/misaligning when zoomed.
    const w = img.offsetWidth, h = img.offsetHeight;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    if (mode === "smart" && smartOverlayRef.current) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(smartOverlayRef.current, 0, 0, w, h);
    } else if (mode === "sam" && mask) {
      const off = document.createElement("canvas");
      off.width = mask.width; off.height = mask.height;
      off.getContext("2d")!.putImageData(maskToImageData(mask.mask, mask.width, mask.height), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, w, h);
    }
    if (mode === "sam") {
      const sx = w / imageW, sy = h / imageH;
      for (const p of points) {
        ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, 6, 0, Math.PI * 2);
        ctx.fillStyle = p.label === 1 ? "#3df27e" : "#ef4444"; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      }
    }
  }, [mode, mask, points, imageW, imageH, ver]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const runDecode = useCallback(async (pts: SamPoint[]) => {
    if (status !== "ready" || pts.length === 0) { setMask(null); return; }
    setBusy(true);
    try { setMask(await clientRef.current!.decode(pts, imageW, imageH)); } catch { /* ignore */ }
    setBusy(false);
  }, [status, imageW, imageH]);

  pointsRef.current = points;
  const imgCoords = (e: React.MouseEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * imageW),
      y: Math.floor(((e.clientY - r.top) / r.height) * imageH),
      sc: (r.width / imageW) || 1,
    };
  };
  const pickSeed = (e: React.MouseEvent) => {
    e.preventDefault();
    ensureSample();
    const px = samplePixels.current; if (!px) return;
    const { x, y } = imgCoords(e); const j = (y * imageW + x) * 4;
    onSwatch?.([px[j], px[j + 1], px[j + 2]]);
    setSeed([x, y]);
  };
  // SAM points are individually editable: click empty = add (right-click = exclude),
  // drag a point = move, click ON a point = delete, Ctrl+Z = undo last.
  const hitPointIdx = (ix: number, iy: number, sc: number) => {
    const tol = 10 / sc;
    for (let i = points.length - 1; i >= 0; i--) if (Math.hypot(points[i].x - ix, points[i].y - iy) <= tol) return i;
    return -1;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode === "smart") { pickSeed(e); return; }
    if (status !== "ready") return;
    const { x, y, sc } = imgCoords(e);
    const idx = hitPointIdx(x, y, sc);
    if (idx >= 0) { e.preventDefault(); e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); dragPt.current = { idx, moved: false }; return; }
    e.preventDefault();
    const next = [...points, { x, y, label: (e.button === 2 ? 0 : 1) as 0 | 1 }];
    setPoints(next); runDecode(next);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (mode !== "sam" || !dragPt.current) return;
    e.stopPropagation();
    const { x, y } = imgCoords(e);
    dragPt.current.moved = true;
    setPoints((prev) => prev.map((p, i) => (i === dragPt.current!.idx ? { ...p, x, y } : p)));
  };
  const onPointerUp = () => {
    if (mode !== "sam" || !dragPt.current) return;
    const d = dragPt.current; dragPt.current = null;
    if (!d.moved) setPoints((prev) => { const next = prev.filter((_, i) => i !== d.idx); runDecode(next); return next; });
    else runDecode(pointsRef.current);
  };
  const onImageContext = (e: React.MouseEvent) => { e.preventDefault(); };

  // Ctrl+Z removes the last SAM point (the page yields Ctrl+Z while in this tool).
  useEffect(() => {
    if (mode !== "sam") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setPoints((prev) => { if (!prev.length) return prev; const next = prev.slice(0, -1); runDecode(next); return next; });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, runDecode]);

  const hasMask = mode === "smart" ? !!smartAlphaRef.current : !!mask;
  useEffect(() => { onMaskChange?.(hasMask); }, [hasMask, onMaskChange]);
  useEffect(() => { onStatusChange?.({ status, msg: statusMsg, device }); }, [status, statusMsg, device, onStatusChange]);

  const apply = useCallback((role: Role) => {
    const full = document.createElement("canvas");
    full.width = imageW; full.height = imageH;
    const ctx = full.getContext("2d")!;
    let srcCanvas: HTMLCanvasElement;
    if (mode === "smart" && smartAlphaRef.current) {
      const a = matte && samplePixels.current
        ? refineAlphaGuided(smartAlphaRef.current, samplePixels.current, imageW, imageH, 6, 1e-3)
        : smartAlphaRef.current;
      const c = document.createElement("canvas"); c.width = imageW; c.height = imageH;
      const cc = c.getContext("2d")!; const id = cc.createImageData(imageW, imageH);
      for (let i = 0; i < a.length; i++) { const j = i * 4; id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = a[i]; }
      cc.putImageData(id, 0, 0); srcCanvas = c;
    } else if (mode === "sam" && mask) {
      const small = maskToAlphaCanvas(mask.mask, mask.width, mask.height);
      const c = document.createElement("canvas"); c.width = imageW; c.height = imageH;
      c.getContext("2d")!.drawImage(small, 0, 0, imageW, imageH); srcCanvas = c;
    } else return;
    if (feather > 0) ctx.filter = `blur(${feather}px)`;
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.filter = "none";
    onApply(role, full.toDataURL("image/png"));
  }, [mode, matte, feather, mask, imageW, imageH, onApply]);

  const clear = useCallback(() => {
    setPoints([]); setMask(null); setSeed(null);
    smartAlphaRef.current = null; smartOverlayRef.current = null; setVer(v => v + 1);
    onSwatch?.(null);
  }, [onSwatch]);

  useEffect(() => { if (apiRef) apiRef.current = { apply, clear }; }, [apiRef, apply, clear]);

  return (
    <div ref={wrapRef} className="relative select-none rounded-xl overflow-hidden">
      {sampleSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={sampleImgRef} src={sampleSrc} alt="" aria-hidden className="hidden" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef} src={imageUrl} alt="scene" draggable={false} className="w-full block touch-none"
        style={{ cursor: "crosshair" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} onContextMenu={onImageContext}
      />
      <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
      {status !== "ready" && mode === "sam" && (
        <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-center px-6">
          {status === "error"
            ? <p className="text-red-400 text-sm">{statusMsg}</p>
            : <><Loader2 size={24} className="animate-spin text-acc" /><p className="text-zinc-300 text-sm">{statusMsg}</p></>}
        </div>
      )}
      {busy && status === "ready" && mode === "sam" && (
        <div className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5"><Loader2 size={12} className="animate-spin text-acc" /></div>
      )}
    </div>
  );
}
