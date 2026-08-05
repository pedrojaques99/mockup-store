"use client";

/**
 * LuzOverlay — renderiza as camadas Luz/Sombra sobre o canvas base, dentro do
 * wrapper do ZoomPanViewer. Preview = CSS (transform + filter:contrast +
 * mix-blend-mode + opacity + clip-path:inset p/ recorte), espelhando 1:1 o que o
 * render server-side compõe.
 *
 * Camada ativa é manipulável direto no canvas (na unha — à prova do zoom do viewer
 * porque tudo é mapeado pela getBoundingClientRect viva):
 *  · modo transform (padrão): arrastar corpo = posição · cantos = resize ANCORADO no
 *    canto oposto (escala uniforme, estilo Photoshop) · topo = rotação
 *  · modo crop: cantos recortam a textura (espaço próprio, pré-rotação)
 *
 * Máscara (maskMode): clipa a camada a uma região da cena (art / superfície). No
 * preview é aplicada como CSS mask NO MESMO <img> do blend (mask-size/position
 * mapeiam a máscara de cena → caixa local do img) pra não quebrar o mix-blend-mode.
 *
 * As alças vivem num wrapper separado (espelha a mesma caixa) pra não entrar no blend.
 */
import { useEffect, useRef, useState } from "react";
import { isFullCrop, type LuzLayer, type LuzLayerId } from "@/types/luz";
import { quadToMatrix3d } from "@/lib/luz-warp";
import { useViewerZoom } from "@/components/viewer-zoom";
import { HANDLE_PX, HANDLE_BORDER, OUTLINE_PX } from "@/components/photo-tools/handle-style";
import { ACC2, ACC2_RGB } from "@/lib/brand";

type CropRect = { x: number; y: number; w: number; h: number };
const cropClip = (c: CropRect) =>
  `inset(${(c.y * 100).toFixed(2)}% ${((1 - (c.x + c.w)) * 100).toFixed(2)}% ${((1 - (c.y + c.h)) * 100).toFixed(2)}% ${(c.x * 100).toFixed(2)}%)`;

// Cantos do resize: sinal da direção do canto a partir do centro (sx=→, sy=↓).
const CORNERS = [
  { key: "tl", sx: -1, sy: -1, css: "nwse-resize", left: 0, top: 0 },
  { key: "tr", sx: 1, sy: -1, css: "nesw-resize", left: 100, top: 0 },
  { key: "bl", sx: -1, sy: 1, css: "nesw-resize", left: 0, top: 100 },
  { key: "br", sx: 1, sy: 1, css: "nwse-resize", left: 100, top: 100 },
] as const;

export function LuzOverlay({
  layers,
  activeId,
  interactive,
  cropMode,
  maskUrls,
  onPosition,
  onScale,
  onRotate,
  onCrop,
  onToggleCrop,
  onActivate,
}: {
  layers: LuzLayer[];
  activeId: LuzLayerId;
  interactive: boolean;
  cropMode: boolean;
  /** Máscaras em espaço de CENA (data-URL PNG, alinhadas 100%×100% ao canvas). */
  maskUrls?: { art?: string | null; surface?: string | null };
  onPosition: (id: LuzLayerId, pos: { x: number; y: number }) => void;
  onScale: (id: LuzLayerId, scale: number) => void;
  onRotate: (id: LuzLayerId, rotation: number) => void;
  onCrop: (id: LuzLayerId, crop: CropRect) => void;
  /** Duplo-clique na mídia → alterna o modo recorte (substitui o botão "Recortar"). */
  onToggleCrop?: () => void;
  /** Clique numa mídia inativa no canvas → ativa aquela camada. */
  onActivate?: (id: LuzLayerId) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<LuzLayerId | null>(null);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  // Hover na mídia ativa (feedback estilo Figma: contorno ao passar o mouse).
  const [hoverId, setHoverId] = useState<LuzLayerId | null>(null);
  // Zoom do viewer → contra-escala (1/zoom) p/ alças/contornos com tamanho de tela constante.
  const zoom = useViewerZoom();
  const k = (px: number) => px / zoom;
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
  // op de resize (canto oposto fixo) ou rotação.
  const op = useRef<
    | { id: LuzLayerId; mode: "scale"; sx: number; sy: number; aspect: number; theta: number; fx: number; fy: number; W: number; H: number }
    | { id: LuzLayerId; mode: "rotate"; cx: number; cy: number }
    | null
  >(null);
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

  // ── Resize ancorado no canto oposto (escala uniforme, com rotação) ──────────
  const cornerDown = (e: React.PointerEvent, l: LuzLayer, c: typeof CORNERS[number]) => {
    if (e.button !== 0) return; // meio = pan
    e.preventDefault(); e.stopPropagation();
    const r = boxRef.current!.getBoundingClientRect();
    const W = r.width, H = r.height;
    const aspect = aspects[l.id] ?? 1;
    const theta = (l.rotation * Math.PI) / 180;
    const cx = l.position.x * W, cy = l.position.y * H;
    const wpx = l.scale * W, hpx = wpx / aspect;
    // Canto oposto em local: (-sx*w/2, -sy*h/2) → mundo (rotacionado em torno do centro).
    const olx = -c.sx * wpx / 2, oly = -c.sy * hpx / 2;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const fx = cx + olx * cosT - oly * sinT;
    const fy = cy + olx * sinT + oly * cosT;
    op.current = { id: l.id, mode: "scale", sx: c.sx, sy: c.sy, aspect, theta, fx, fy, W, H };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  };

  // ── Rotação (âncora no centro) ──────────────────────────────────────────────
  const rotateDown = (e: React.PointerEvent, l: LuzLayer) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r = boxRef.current!.getBoundingClientRect();
    op.current = { id: l.id, mode: "rotate", cx: r.left + l.position.x * r.width, cy: r.top + l.position.y * r.height };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  };

  const handleMove = (e: React.PointerEvent) => {
    const o = op.current;
    if (!o || !boxRef.current) return;
    if (o.mode === "rotate") {
      const ang = (Math.atan2(e.clientY - o.cy, e.clientX - o.cx) * 180) / Math.PI;
      onRotate(o.id, Math.round(((ang + 90 + 180) % 360) - 180));
      return;
    }
    // resize: cursor (px rel. ao canvas), projeta no frame local (pré-rotação) ancorado em F.
    const r = boxRef.current.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const dx = px - o.fx, dy = py - o.fy;
    const cosT = Math.cos(-o.theta), sinT = Math.sin(-o.theta);
    const lx = dx * cosT - dy * sinT;       // distância local F→cursor
    // largura nova dirigida pelo eixo X local; mantém proporção (uniforme).
    let wpx = Math.abs(lx);
    wpx = Math.max(0.1 * o.W, Math.min(8 * o.W, wpx));
    const hpx = wpx / o.aspect;
    // Centro novo: meia-caixa a partir de F na direção do canto arrastado (mundo).
    const clx = o.sx * wpx / 2, cly = o.sy * hpx / 2;
    const c2 = Math.cos(o.theta), s2 = Math.sin(o.theta);
    const ccx = o.fx + clx * c2 - cly * s2;
    const ccy = o.fy + clx * s2 + cly * c2;
    onScale(o.id, wpx / o.W);
    onPosition(o.id, { x: ccx / o.W, y: ccy / o.H });
  };
  const handleUp = (e: React.PointerEvent) => {
    if (!op.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    op.current = null;
  };

  // ── Alças de crop (recorte em espaço próprio da textura, pré-rotação) ────────
  const cropDown = (e: React.PointerEvent, l: LuzLayer, corner: "tl" | "tr" | "bl" | "br") => {
    if (e.button !== 0) return;
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

  const HANDLE = "absolute -translate-x-1/2 -translate-y-1/2 rounded-sm bg-zinc-950 border-acc2 shadow";
  const CROP_HANDLE = "absolute -translate-x-1/2 -translate-y-1/2 rounded-sm bg-zinc-950 border-amber-400 shadow";
  // Tamanho da alça em px de tela (constante no zoom).
  const handleSize: React.CSSProperties = { width: k(HANDLE_PX), height: k(HANDLE_PX), borderWidth: k(HANDLE_BORDER), borderStyle: "solid" };

  return (
    <div ref={boxRef} className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {layers
        .filter((l) => l.visible && l.src)
        .map((l) => {
          const isActive = interactive && l.id === activeId;
          const clip = isFullCrop(l.crop) ? undefined : cropClip(l.crop);
          const warped = !!l.warpQuad && box.w > 0;
          const aspect = aspects[l.id] ?? 1;
          // Máscara de cena (clip art/superfície). Aplicada só no caminho afim (warp+mask
          // fica exato só no render). mask-size/position mapeiam a máscara de cena → caixa
          // local do img, no MESMO elemento do blend (não isola o mix-blend-mode).
          const maskUrl =
            l.maskMode === "art" ? maskUrls?.art : l.maskMode === "surface" ? maskUrls?.surface : null;
          const wpx = l.scale * box.w, hpx = wpx / aspect;
          const maskStyle: React.CSSProperties =
            maskUrl && !warped && box.w > 0
              ? {
                  WebkitMaskImage: `url(${maskUrl})`,
                  maskImage: `url(${maskUrl})`,
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskSize: `${box.w}px ${box.h}px`,
                  maskSize: `${box.w}px ${box.h}px`,
                  WebkitMaskPosition: `${-(l.position.x * box.w - wpx / 2)}px ${-(l.position.y * box.h - hpx / 2)}px`,
                  maskPosition: `${-(l.position.x * box.w - wpx / 2)}px ${-(l.position.y * box.h - hpx / 2)}px`,
                }
              : {};
          // mantém opacity/contrast/mix-blend-mode/clip-path nos dois.
          const toneStyle: React.CSSProperties = {
            opacity: l.opacity,
            filter: `contrast(${l.contrast}%)`,
            mixBlendMode: l.blendMode as React.CSSProperties["mixBlendMode"],
            clipPath: clip,
            WebkitClipPath: clip,
            userSelect: "none",
            touchAction: "none",
            ...maskStyle,
          };
          let imgStyle: React.CSSProperties;
          if (warped) {
            const q = l.warpQuad!;
            const w0 = box.w, h0 = w0 / aspect;
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
              // Interativo também nas camadas inativas → clique ativa; hover contorna.
              pointerEvents: interactive ? "auto" : "none",
              cursor: isActive ? "move" : interactive ? "pointer" : "default",
              zIndex: isActive ? 3 : 1,
            };
          }
          const wrapBase: React.CSSProperties = {
            position: "absolute",
            left: `${l.position.x * 100}%`,
            top: `${l.position.y * 100}%`,
            width: `${l.scale * 100}%`,
            aspectRatio: String(aspect),
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
                  if (!interactive || warped) return;
                  if (e.button !== 0) return; // meio = pan; não arrasta nem ativa
                  if (!isActive) { onActivate?.(l.id); return; } // clique numa inativa = ativa
                  if (cropMode) return;
                  e.preventDefault();
                  dragging.current = l.id;
                  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
                }}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onPointerEnter={() => { if (interactive) setHoverId(l.id); }}
                onPointerLeave={() => setHoverId((h) => (h === l.id ? null : h))}
                onDoubleClick={(e) => { if (isActive && !warped) { e.stopPropagation(); e.preventDefault(); onToggleCrop?.(); } }}
                style={imgStyle}
              />

              {/* ── Modo TRANSFORM — caixa + cantos (resize ancorado) + topo (rotação) ──
                  Só no modo afim; com warpQuad as alças são o QuadEditor (page). */}
              {/* Hover numa camada INATIVA — só contorno sutil (sem alças); clique ativa. */}
              {interactive && !isActive && !cropMode && !warped && hoverId === l.id && (
                <div style={{ ...wrapBase, outline: `${k(OUTLINE_PX)}px solid rgba(${ACC2_RGB},0.45)`, outlineOffset: k(1), zIndex: 2 }} />
              )}

              {isActive && !cropMode && !warped && (
                <div style={{
                  ...wrapBase,
                  zIndex: 4,
                  // Figma-like: contorno sólido/brilhante no hover, tracejado fora dele.
                  outline: hoverId === l.id ? `${k(2)}px solid ${ACC2}` : `${k(1)}px dashed rgba(${ACC2_RGB},0.6)`,
                  outlineOffset: hoverId === l.id ? k(1) : 0,
                  transition: "outline-color 0.1s",
                }}>
                  {CORNERS.map((c) => (
                    <div
                      key={c.key}
                      className={HANDLE}
                      style={{ ...handleSize, left: `${c.left}%`, top: `${c.top}%`, pointerEvents: "auto", cursor: c.css, touchAction: "none" }}
                      onPointerDown={(e) => cornerDown(e, l, c)}
                      onPointerMove={handleMove}
                      onPointerUp={handleUp}
                      onPointerCancel={handleUp}
                    />
                  ))}
                  <div style={{ position: "absolute", left: "50%", top: 0, width: k(1), height: k(22), transform: "translate(-50%,-100%)", background: `rgba(${ACC2_RGB},0.6)`, pointerEvents: "none" }} />
                  <div
                    className="absolute -translate-x-1/2 rounded-full bg-acc2 border-zinc-950 shadow"
                    style={{ left: "50%", top: 0, width: k(14), height: k(14), borderWidth: k(2), borderStyle: "solid", transform: `translate(-50%, calc(-100% - ${k(22)}px))`, pointerEvents: "auto", cursor: "grab", touchAction: "none" }}
                    onPointerDown={(e) => rotateDown(e, l)}
                    onPointerMove={handleMove}
                    onPointerUp={handleUp}
                    onPointerCancel={handleUp}
                  />
                </div>
              )}

              {/* ── Modo CROP — caixa cheia (fraca) + retângulo de recorte (âmbar) ── */}
              {isActive && cropMode && !warped && (
                <div style={{ ...wrapBase, outline: `${k(1)}px dashed rgba(255,255,255,0.25)` }}>
                  <div style={{
                    position: "absolute",
                    left: `${l.crop.x * 100}%`, top: `${l.crop.y * 100}%`,
                    width: `${l.crop.w * 100}%`, height: `${l.crop.h * 100}%`,
                    outline: `${k(OUTLINE_PX)}px solid rgba(251,191,36,0.9)`, pointerEvents: "none",
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
                      style={{ ...handleSize, left: `${h.x * 100}%`, top: `${h.y * 100}%`, pointerEvents: "auto", cursor: h.c, touchAction: "none" }}
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
