"use client";

/**
 * LuzOverlay — renderiza as camadas Luz/Sombra sobre o canvas base, dentro do
 * wrapper do ZoomPanViewer. Preview = CSS (transform + filter:contrast +
 * mix-blend-mode + opacity + clip-path:inset p/ recorte), espelhando 1:1 o que o
 * render server-side compõe.
 *
 * Camada ativa é manipulável direto no canvas:
 *  · modo transform (padrão): arrastar corpo = posição · cantos = escala · topo = rotação
 *  · modo crop: cantos recortam a textura (espaço próprio, pré-rotação)
 * O <img> mantém transform+mix-blend-mode pra blendar com a CENA; as alças vivem
 * num wrapper separado (espelha a mesma caixa) pra não entrar no blend.
 */
import { useEffect, useRef, useState } from "react";
import { isFullCrop, type LuzLayer, type LuzLayerId } from "@/types/luz";
import { quadToMatrix3d } from "@/lib/luz-warp";

type CropRect = { x: number; y: number; w: number; h: number };
const cropClip = (c: CropRect) =>
  `inset(${(c.y * 100).toFixed(2)}% ${((1 - (c.x + c.w)) * 100).toFixed(2)}% ${((1 - (c.y + c.h)) * 100).toFixed(2)}% ${(c.x * 100).toFixed(2)}%)`;

export function LuzOverlay({
  layers,
  activeId,
  interactive,
  cropMode,
  onPosition,
  onScale,
  onRotate,
  onCrop,
}: {
  layers: LuzLayer[];
  activeId: LuzLayerId;
  interactive: boolean;
  cropMode: boolean;
  onPosition: (id: LuzLayerId, pos: { x: number; y: number }) => void;
  onScale: (id: LuzLayerId, scale: number) => void;
  onRotate: (id: LuzLayerId, rotation: number) => void;
  onCrop: (id: LuzLayerId, crop: CropRect) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<LuzLayerId | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  // Tamanho px do canvas (pra converter o warpQuad normalizado → px no matrix3d).
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);
  const op = useRef<{ id: LuzLayerId; mode: "scale" | "rotate"; startScale: number; startDist: number; cx: number; cy: number } | null>(null);
  const cropOp = useRef<{ id: LuzLayerId; corner: "tl" | "tr" | "bl" | "br" } | null>(null);

  // ── Drag de posição (corpo) ────────────────────────────────────────────────
  const move = (e: React.PointerEvent) => {
    if (!dragging.current || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    onPosition(dragging.current, { x, y });
  };
  const end = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    dragging.current = null;
  };

  const centerClient = (l: LuzLayer) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { cx: r.left + l.position.x * r.width, cy: r.top + l.position.y * r.height, r };
  };

  // ── Alças de transform (escala/rotação, âncora no centro) ───────────────────
  const handleDown = (e: React.PointerEvent, l: LuzLayer, mode: "scale" | "rotate") => {
    e.preventDefault(); e.stopPropagation();
    const { cx, cy } = centerClient(l);
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    op.current = { id: l.id, mode, startScale: l.scale, startDist: dist, cx, cy };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  };
  const handleMove = (e: React.PointerEvent) => {
    if (!op.current) return;
    const { id, mode, startScale, startDist, cx, cy } = op.current;
    if (mode === "scale") {
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      onScale(id, Math.max(0.1, Math.min(8, startScale * (d / startDist))));
    } else {
      const ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
      onRotate(id, Math.round(((ang + 90 + 180) % 360) - 180));
    }
  };
  const handleUp = (e: React.PointerEvent) => {
    if (!op.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    op.current = null;
  };

  // ── Alças de crop (recorte em espaço próprio da textura, pré-rotação) ────────
  const cropDown = (e: React.PointerEvent, l: LuzLayer, corner: "tl" | "tr" | "bl" | "br") => {
    e.preventDefault(); e.stopPropagation();
    cropOp.current = { id: l.id, corner };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  };
  const cropMoveFn = (e: React.PointerEvent) => {
    if (!cropOp.current || !boxRef.current) return;
    const l = layers.find((x) => x.id === cropOp.current!.id);
    if (!l) return;
    const r = boxRef.current.getBoundingClientRect();
    const cx = r.left + l.position.x * r.width, cy = r.top + l.position.y * r.height;
    const boxW = l.scale * r.width;
    const boxH = boxW / (aspects[l.id] ?? 1);
    const rad = (-l.rotation * Math.PI) / 180;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const u = Math.max(0, Math.min(1, lx / boxW + 0.5));
    const v = Math.max(0, Math.min(1, ly / boxH + 0.5));
    const MIN = 0.05;
    let { x, y, w, h } = l.crop;
    const x2 = x + w, y2 = y + h;
    switch (cropOp.current.corner) {
      case "tl": x = Math.min(u, x2 - MIN); y = Math.min(v, y2 - MIN); w = x2 - x; h = y2 - y; break;
      case "tr": w = Math.max(u, x + MIN) - x; y = Math.min(v, y2 - MIN); h = y2 - y; break;
      case "bl": x = Math.min(u, x2 - MIN); w = x2 - x; h = Math.max(v, y + MIN) - y; break;
      case "br": w = Math.max(u, x + MIN) - x; h = Math.max(v, y + MIN) - y; break;
    }
    onCrop(l.id, { x, y, w, h });
  };
  const cropUp = (e: React.PointerEvent) => {
    if (!cropOp.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    cropOp.current = null;
  };

  const HANDLE = "absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-zinc-950 border-2 border-acc2 shadow";
  const CROP_HANDLE = "absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-zinc-950 border-2 border-amber-400 shadow";

  return (
    <div ref={boxRef} className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {layers
        .filter((l) => l.visible && l.src)
        .map((l) => {
          const isActive = interactive && l.id === activeId;
          const clip = isFullCrop(l.crop) ? undefined : cropClip(l.crop);
          const warped = !!l.warpQuad && box.w > 0;
          // Estilo do <img>: warp (matrix3d homográfico) ou afim (translate/rotate/scale).
          // mantém opacity/contrast/mix-blend-mode/clip-path nos dois.
          const toneStyle: React.CSSProperties = {
            opacity: l.opacity,
            filter: `contrast(${l.contrast}%)`,
            mixBlendMode: l.blendMode as React.CSSProperties["mixBlendMode"],
            clipPath: clip,
            WebkitClipPath: clip,
            userSelect: "none",
            touchAction: "none",
          };
          let imgStyle: React.CSSProperties;
          if (warped) {
            const q = l.warpQuad!;
            const w0 = box.w, h0 = w0 / (aspects[l.id] ?? 1);
            const dst: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
              { x: q.tl.x * box.w, y: q.tl.y * box.h },
              { x: q.tr.x * box.w, y: q.tr.y * box.h },
              { x: q.br.x * box.w, y: q.br.y * box.h },
              { x: q.bl.x * box.w, y: q.bl.y * box.h },
            ];
            imgStyle = {
              ...toneStyle,
              position: "absolute", left: 0, top: 0, width: `${w0}px`, height: `${h0}px`,
              transformOrigin: "0 0", transform: quadToMatrix3d(w0, h0, dst),
              pointerEvents: "none", // alças = QuadEditor (page); img não captura
            };
          } else {
            imgStyle = {
              ...toneStyle,
              position: "absolute",
              left: `${l.position.x * 100}%`,
              top: `${l.position.y * 100}%`,
              width: `${l.scale * 100}%`,
              height: "auto",
              transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
              transformOrigin: "center",
              pointerEvents: isActive ? "auto" : "none",
              cursor: isActive ? "move" : "default",
            };
          }
          const wrapBase: React.CSSProperties = {
            position: "absolute",
            left: `${l.position.x * 100}%`,
            top: `${l.position.y * 100}%`,
            width: `${l.scale * 100}%`,
            aspectRatio: String(aspects[l.id] ?? 1),
            transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
            transformOrigin: "center",
            pointerEvents: "none",
            touchAction: "none",
          };
          return (
            <div key={l.id} className="contents">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={l.src!}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const im = e.currentTarget;
                  const a = im.naturalWidth / im.naturalHeight;
                  setAspects((m) => (m[l.id] === a ? m : { ...m, [l.id]: a }));
                }}
                onPointerDown={(e) => {
                  if (!isActive) return;
                  e.preventDefault();
                  dragging.current = l.id;
                  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
                }}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                style={imgStyle}
              />

              {/* ── Modo TRANSFORM — caixa cheia + cantos (escala) + topo (rotação) ──
                  Só no modo afim; com warpQuad as alças são o QuadEditor (page). */}
              {isActive && !cropMode && !warped && (
                <div style={{ ...wrapBase, outline: "1px dashed rgba(61,242,126,0.6)" }}>
                  {([
                    { l: 0, t: 0, c: "nwse-resize" },
                    { l: 100, t: 0, c: "nesw-resize" },
                    { l: 0, t: 100, c: "nesw-resize" },
                    { l: 100, t: 100, c: "nwse-resize" },
                  ] as const).map((h, i) => (
                    <div
                      key={i}
                      className={HANDLE}
                      style={{ left: `${h.l}%`, top: `${h.t}%`, pointerEvents: "auto", cursor: h.c, touchAction: "none" }}
                      onPointerDown={(e) => handleDown(e, l, "scale")}
                      onPointerMove={handleMove}
                      onPointerUp={handleUp}
                      onPointerCancel={handleUp}
                    />
                  ))}
                  <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: 22, transform: "translate(-50%,-100%)", background: "rgba(61,242,126,0.6)", pointerEvents: "none" }} />
                  <div
                    className="absolute w-3.5 h-3.5 -translate-x-1/2 rounded-full bg-acc2 border-2 border-zinc-950 shadow"
                    style={{ left: "50%", top: 0, transform: "translate(-50%, calc(-100% - 22px))", pointerEvents: "auto", cursor: "grab", touchAction: "none" }}
                    onPointerDown={(e) => handleDown(e, l, "rotate")}
                    onPointerMove={handleMove}
                    onPointerUp={handleUp}
                    onPointerCancel={handleUp}
                  />
                </div>
              )}

              {/* ── Modo CROP — caixa cheia (fraca) + retângulo de recorte (âmbar) ── */}
              {isActive && cropMode && !warped && (
                <div style={{ ...wrapBase, outline: "1px dashed rgba(255,255,255,0.25)" }}>
                  {/* retângulo do recorte */}
                  <div style={{
                    position: "absolute",
                    left: `${l.crop.x * 100}%`, top: `${l.crop.y * 100}%`,
                    width: `${l.crop.w * 100}%`, height: `${l.crop.h * 100}%`,
                    outline: "1.5px solid rgba(251,191,36,0.9)", pointerEvents: "none",
                  }} />
                  {([
                    { corner: "tl", x: l.crop.x, y: l.crop.y, c: "nwse-resize" },
                    { corner: "tr", x: l.crop.x + l.crop.w, y: l.crop.y, c: "nesw-resize" },
                    { corner: "bl", x: l.crop.x, y: l.crop.y + l.crop.h, c: "nesw-resize" },
                    { corner: "br", x: l.crop.x + l.crop.w, y: l.crop.y + l.crop.h, c: "nwse-resize" },
                  ] as const).map((h) => (
                    <div
                      key={h.corner}
                      className={CROP_HANDLE}
                      style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, pointerEvents: "auto", cursor: h.c, touchAction: "none" }}
                      onPointerDown={(e) => cropDown(e, l, h.corner)}
                      onPointerMove={cropMoveFn}
                      onPointerUp={cropUp}
                      onPointerCancel={cropUp}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
