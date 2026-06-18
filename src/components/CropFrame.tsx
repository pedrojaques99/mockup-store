"use client";

/**
 * CropFrame — moldura de corte estilo Photoshop sobre a foto. 8 alças (4 cantos +
 * 4 bordas) + arrastar a moldura inteira, sobre [react-moveable] (lib validada —
 * substitui a implementação de alças na unha). A moldura PODE passar das bordas da
 * imagem → vira expansão (outpaint), detectado a jusante no page.
 *
 * Vive DENTRO do ZoomPanViewer como overlay transparente (igual QuadEditor): a
 * imagem base persistente mostra os pixels; aqui o <img> só dá layout (opacity 0
 * quando transparentImg). Geometria robusta sob zoom/pan: leio o rect do alvo
 * RELATIVO ao rect VIVO da <img> — a escala CSS do viewer se cancela na divisão,
 * então px-de-tela → px-natural vale em qualquer zoom. O Moveable mexe no DOM
 * durante o gesto; o estado React (rect natural) sincroniza no fim de cada gesto.
 *
 * Reporta o rect via onChange { x, y, width, height } em px naturais (pode ser
 * negativo / exceder a imagem). Interface idêntica à versão anterior.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Moveable from "react-moveable";
import { useViewerZoom } from "@/components/viewer-zoom";
import { HANDLE_FILL, HANDLE_PX, HANDLE_BORDER, OUTLINE_PX } from "@/components/photo-tools/handle-style";

export interface CropRect { x: number; y: number; width: number; height: number }

const MIN = 8; // px naturais — tamanho mínimo da moldura
const HANDLES: ("nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w")[] =
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// CSS escopado pelo .crop-moveable — alças com a linguagem visual única (handle-style)
// e tamanho de TELA constante: tudo × var(--mv) (= 1/zoom do viewer).
const THEME_CSS = `
.crop-moveable .moveable-line { background: var(--crop-accent) !important; }
.crop-moveable .moveable-control {
  width: calc(${HANDLE_PX}px * var(--mv)); height: calc(${HANDLE_PX}px * var(--mv));
  margin-top: calc(${-HANDLE_PX / 2}px * var(--mv)); margin-left: calc(${-HANDLE_PX / 2}px * var(--mv));
  background: ${HANDLE_FILL}; border: calc(${HANDLE_BORDER}px * var(--mv)) solid var(--crop-accent);
  border-radius: 2px; box-sizing: border-box;
}
`;

export function CropFrame({
  imageUrl,
  naturalW,
  naturalH,
  aspect,
  onChange,
  resetKey,
  transparentImg,
  onApply,
}: {
  imageUrl: string;
  naturalW: number;
  naturalH: number;
  aspect?: number;
  onChange: (r: CropRect) => void;
  /** muda → reinicia a moldura pra imagem inteira */
  resetKey: number;
  /** quando true a img fica invisível (opacity 0) — a base persistente do viewer mostra os pixels */
  transparentImg?: boolean;
  /** Duplo-clique dentro da moldura → aplica o corte (substitui depender só do botão). */
  onApply?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moveableRef = useRef<any>(null);
  // tamanho exibido da img em px de LAYOUT (sem o transform do viewer)
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  // rect em px naturais (SSoT da posição de descanso da moldura)
  const [rect, setRect] = useState<CropRect>({ x: 0, y: 0, width: naturalW, height: naturalH });
  const [hover, setHover] = useState(false);
  // Zoom do viewer → contra-escala (1/zoom) p/ alças/contornos com tamanho de tela constante.
  const zoom = useViewerZoom();
  const k = (px: number) => px / zoom;

  // Mede a img pelo LAYOUT (offset*), não pela bounding rect — a última reflete o
  // transform CSS do ZoomPanViewer. Assim a moldura escala UNIFORME com o transform.
  useEffect(() => {
    const root = rootRef.current, img = imgRef.current;
    if (!root || !img) return;
    const update = () => setLayout({ w: img.offsetWidth, h: img.offsetHeight });
    const ro = new ResizeObserver(update);
    ro.observe(root);
    img.onload = update;
    update();
    return () => ro.disconnect();
  }, []);

  // Reinicia pra imagem inteira
  useEffect(() => {
    setRect({ x: 0, y: 0, width: naturalW, height: naturalH });
  }, [resetKey, naturalW, naturalH]);

  // Snap pra proporção escolhida (centrado, cabendo na imagem)
  useEffect(() => {
    if (!aspect) return;
    setRect((r) => {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      let w = r.width, h = w / aspect;
      if (w > naturalW) { w = naturalW; h = w / aspect; }
      if (h > naturalH) { h = naturalH; w = h * aspect; }
      return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    });
  }, [aspect, naturalW, naturalH]);

  // Reporta a posição de descanso
  useEffect(() => { onChange(rect); }, [rect, onChange]);

  // Mantém as alças do Moveable alinhadas quando rect/layout mudam externamente
  useEffect(() => { moveableRef.current?.updateRect(); }, [rect, layout]);

  // Escala de LAYOUT (px de layout por px natural). A img mora em (0,0) preenchendo a largura.
  const scale = (layout.w / naturalW) || 1;

  // px-de-tela → px-natural via rect VIVO da <img> (a escala do viewer se cancela)
  const readNatural = useCallback((): CropRect | null => {
    const ir = imgRef.current?.getBoundingClientRect();
    const tr = targetRef.current?.getBoundingClientRect();
    if (!ir || !tr || !ir.width || !ir.height) return null;
    return {
      x: ((tr.left - ir.left) / ir.width) * naturalW,
      y: ((tr.top - ir.top) / ir.height) * naturalH,
      width: (tr.width / ir.width) * naturalW,
      height: (tr.height / ir.height) * naturalH,
    };
  }, [naturalW, naturalH]);

  const commit = useCallback(() => {
    const r = readNatural();
    const t = targetRef.current;
    if (t) t.style.transform = ""; // limpa o translate do resize; React re-renderiza no left/top canônico
    if (!r) return;
    setRect({ x: r.x, y: r.y, width: Math.max(MIN, r.width), height: Math.max(MIN, r.height) });
  }, [readNatural]);

  const expanding = rect.x < -0.5 || rect.y < -0.5 || rect.x + rect.width > naturalW + 0.5 || rect.y + rect.height > naturalH + 0.5;
  const accent = expanding ? "#22d3ee" : "#3df27e";

  // Posição de descanso do alvo (layout px; img na origem → sem offset)
  const left = rect.x * scale, top = rect.y * scale;
  const width = rect.width * scale, height = rect.height * scale;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 select-none"
      style={{ touchAction: "none", ["--crop-accent" as string]: accent, ["--mv" as string]: String(1 / zoom) }}
    >
      <style>{THEME_CSS}</style>

      {/* Imagem — só dá layout/sizing; os pixels visíveis vêm da base do viewer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="crop"
        draggable={false}
        className="w-full block"
        style={{ pointerEvents: "none", opacity: transparentImg ? 0 : 1 }}
      />

      {layout.w > 0 && (
        <>
          {/* Dim externo (box-shadow gigante = escurece tudo fora) — segue o alvo */}
          <div style={{ position: "absolute", left, top, width, height, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)", pointerEvents: "none" }} />

          {/* Alvo do Moveable: moldura + grade rule-of-thirds. Hover engrossa o contorno (Figma). */}
          <div
            ref={targetRef}
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => setHover(false)}
            onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); onApply?.(); }}
            style={{
              position: "absolute", left, top, width, height, cursor: "move",
              outline: `${k(hover ? OUTLINE_PX + 1 : OUTLINE_PX)}px solid ${accent}`,
              transition: "outline-width 0.1s",
            }}
          >
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.35 }}>
              <div style={{ position: "absolute", left: "33.33%", top: 0, bottom: 0, width: k(1), background: accent }} />
              <div style={{ position: "absolute", left: "66.66%", top: 0, bottom: 0, width: k(1), background: accent }} />
              <div style={{ position: "absolute", top: "33.33%", left: 0, right: 0, height: k(1), background: accent }} />
              <div style={{ position: "absolute", top: "66.66%", left: 0, right: 0, height: k(1), background: accent }} />
            </div>
          </div>

          <Moveable
            ref={moveableRef}
            className="crop-moveable"
            target={targetRef}
            container={rootRef.current}
            origin={false}
            draggable
            resizable
            keepRatio={!!aspect}
            renderDirections={HANDLES}
            throttleDrag={0}
            throttleResize={0}
            onDrag={({ target, left: l, top: t }) => {
              const el = target as HTMLElement;
              el.style.left = `${l}px`;
              el.style.top = `${t}px`;
              const r = readNatural();
              if (r) onChange(r); // live → alimenta accent (expanding) e canApply
            }}
            onDragEnd={commit}
            onResize={({ target, width: w, height: h, drag }) => {
              const el = target as HTMLElement;
              el.style.width = `${w}px`;
              el.style.height = `${h}px`;
              el.style.transform = drag.transform;
              const r = readNatural();
              if (r) onChange(r);
            }}
            onResizeEnd={commit}
          />
        </>
      )}
    </div>
  );
}
