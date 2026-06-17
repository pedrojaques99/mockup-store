"use client";

/**
 * CropFrame — moldura de corte estilo Photoshop sobre a foto. 8 alças (4 cantos +
 * 4 bordas) com resize livre + arrastar a moldura inteira. A moldura PODE passar
 * das bordas da imagem → vira expansão (outpaint), detectado a jusante no page.
 *
 * O retângulo vive em pixels naturais da imagem (x,y podem ser negativos; x+w/y+h
 * podem exceder a imagem). Mapeia natural↔tela via fit "contain". Reporta o rect
 * via onChange no formato { x, y, width, height } (compatível com o handler atual).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface CropRect { x: number; y: number; width: number; height: number }
type Edge = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

function fit(cw: number, ch: number, nw: number, nh: number) {
  const scale = Math.min(cw / nw, ch / nh) || 1;
  const dispW = nw * scale, dispH = nh * scale;
  return { scale, offX: (cw - dispW) / 2, offY: (ch - dispH) / 2, dispW, dispH };
}

export function CropFrame({
  imageUrl,
  naturalW,
  naturalH,
  aspect,
  onChange,
  resetKey,
}: {
  imageUrl: string;
  naturalW: number;
  naturalH: number;
  aspect?: number;
  onChange: (r: CropRect) => void;
  /** muda → reinicia a moldura pra imagem inteira */
  resetKey: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // rect em px naturais (left/top/right/bottom pra facilitar a matemática de borda)
  const [rect, setRect] = useState({ l: 0, t: 0, r: naturalW, b: naturalH });
  const drag = useRef<{ edge: Edge; px: number; py: number; start: typeof rect } | null>(null);

  // Mede o container
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reinicia pra imagem inteira
  useEffect(() => {
    setRect({ l: 0, t: 0, r: naturalW, b: naturalH });
  }, [resetKey, naturalW, naturalH]);

  // Reporta mudanças
  useEffect(() => {
    onChange({ x: rect.l, y: rect.t, width: rect.r - rect.l, height: rect.b - rect.t });
  }, [rect, onChange]);

  const f = fit(box.w, box.h, naturalW, naturalH);
  const toScreen = (nx: number, ny: number) => ({ x: f.offX + nx * f.scale, y: f.offY + ny * f.scale });

  const onPointerDown = useCallback((e: React.PointerEvent, edge: Edge) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { edge, px: e.clientX, py: e.clientY, start: rect };
  }, [rect]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !f.scale) return;
    const dx = (e.clientX - d.px) / f.scale;
    const dy = (e.clientY - d.py) / f.scale;
    let { l, t, r, b } = d.start;

    if (d.edge === "move") {
      l += dx; r += dx; t += dy; b += dy;
    } else {
      if (d.edge.includes("w")) l += dx;
      if (d.edge.includes("e")) r += dx;
      if (d.edge.includes("n")) t += dy;
      if (d.edge.includes("s")) b += dy;
      // normaliza se cruzou
      if (r < l) [l, r] = [r, l];
      if (b < t) [t, b] = [b, t];
      // trava de proporção (cantos, quando aspect definido)
      if (aspect && (d.edge === "nw" || d.edge === "ne" || d.edge === "se" || d.edge === "sw")) {
        const w = r - l;
        const h = w / aspect;
        if (d.edge === "nw" || d.edge === "ne") t = b - h; else b = t + h;
      }
      // tamanho mínimo (8px naturais)
      if (r - l < 8) { if (d.edge.includes("w")) l = r - 8; else r = l + 8; }
      if (b - t < 8) { if (d.edge.includes("n")) t = b - 8; else b = t + 8; }
    }
    setRect({ l, t, r, b });
  }, [f.scale, aspect]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (drag.current) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
      drag.current = null;
    }
  }, []);

  if (!box.w) return <div ref={ref} className="absolute inset-0" />;

  const tl = toScreen(rect.l, rect.t);
  const br = toScreen(rect.r, rect.b);
  const sx = tl.x, sy = tl.y, sw = br.x - tl.x, sh = br.y - tl.y;
  const expanding = rect.l < -0.5 || rect.t < -0.5 || rect.r > naturalW + 0.5 || rect.b > naturalH + 0.5;
  const accent = expanding ? "#22d3ee" : "#3df27e";

  const HANDLES: { id: Edge; cx: number; cy: number; cur: string }[] = [
    { id: "nw", cx: 0, cy: 0, cur: "nwse-resize" }, { id: "n", cx: 0.5, cy: 0, cur: "ns-resize" }, { id: "ne", cx: 1, cy: 0, cur: "nesw-resize" },
    { id: "e", cx: 1, cy: 0.5, cur: "ew-resize" }, { id: "se", cx: 1, cy: 1, cur: "nwse-resize" }, { id: "s", cx: 0.5, cy: 1, cur: "ns-resize" },
    { id: "sw", cx: 0, cy: 1, cur: "nesw-resize" }, { id: "w", cx: 0, cy: 0.5, cur: "ew-resize" },
  ];

  return (
    <div
      ref={ref}
      className="absolute inset-0 select-none"
      style={{ touchAction: "none" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Imagem (contain) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="crop"
        draggable={false}
        style={{ position: "absolute", left: f.offX, top: f.offY, width: f.dispW, height: f.dispH, objectFit: "fill", pointerEvents: "none" }}
      />

      {/* Moldura + dim externo (box-shadow gigante = escurece tudo fora) */}
      <div
        onPointerDown={(e) => onPointerDown(e, "move")}
        style={{
          position: "absolute", left: sx, top: sy, width: sw, height: sh,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          outline: `1.5px solid ${accent}`,
          cursor: "move",
        }}
      >
        {/* Grade rule-of-thirds */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.35 }}>
          <div style={{ position: "absolute", left: "33.33%", top: 0, bottom: 0, width: 1, background: accent }} />
          <div style={{ position: "absolute", left: "66.66%", top: 0, bottom: 0, width: 1, background: accent }} />
          <div style={{ position: "absolute", top: "33.33%", left: 0, right: 0, height: 1, background: accent }} />
          <div style={{ position: "absolute", top: "66.66%", left: 0, right: 0, height: 1, background: accent }} />
        </div>

        {/* Alças */}
        {HANDLES.map((h) => {
          const corner = h.id.length === 2;
          const size = corner ? 12 : 10;
          return (
            <div
              key={h.id}
              onPointerDown={(e) => onPointerDown(e, h.id)}
              style={{
                position: "absolute",
                left: `calc(${h.cx * 100}% - ${size / 2}px)`,
                top: `calc(${h.cy * 100}% - ${size / 2}px)`,
                width: size, height: size,
                background: corner ? accent : "#18181b",
                border: `1.5px solid ${accent}`,
                borderRadius: corner ? 2 : 3,
                cursor: h.cur,
                touchAction: "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
