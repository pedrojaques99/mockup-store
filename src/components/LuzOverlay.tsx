"use client";

/**
 * LuzOverlay — renderiza as camadas Luz/Sombra sobre o canvas base, dentro do
 * wrapper do ZoomPanViewer. Preview = CSS (transform + filter:contrast +
 * mix-blend-mode + opacity), espelhando 1:1 o que o render server-side compõe.
 *
 * Drag de posição é manual (pointer capture nativo) porque o elemento já usa um
 * transform composto (translate(-50%,-50%) rotate scale) — react-draggable
 * sobrescreveria esse transform. Só a camada ativa é arrastável.
 */
import { useRef } from "react";
import type { LuzLayer, LuzLayerId } from "@/types/luz";

export function LuzOverlay({
  layers,
  activeId,
  interactive,
  onPosition,
}: {
  layers: LuzLayer[];
  activeId: LuzLayerId;
  interactive: boolean;
  onPosition: (id: LuzLayerId, pos: { x: number; y: number }) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<LuzLayerId | null>(null);

  const move = (e: React.PointerEvent) => {
    if (!dragging.current || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    onPosition(dragging.current, { x, y });
  };

  const end = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    dragging.current = null;
  };

  return (
    <div ref={boxRef} className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {layers
        .filter((l) => l.visible && l.src)
        .map((l) => {
          const isActive = interactive && l.id === activeId;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={l.id}
              src={l.src!}
              alt=""
              draggable={false}
              onPointerDown={(e) => {
                if (!isActive) return;
                e.preventDefault();
                dragging.current = l.id;
                try {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } catch {}
              }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              style={{
                position: "absolute",
                left: `${l.position.x * 100}%`,
                top: `${l.position.y * 100}%`,
                width: `${l.scale * 100}%`,
                height: "auto",
                transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
                transformOrigin: "center",
                opacity: l.opacity,
                filter: `contrast(${l.contrast}%)`,
                mixBlendMode: l.blendMode as React.CSSProperties["mixBlendMode"],
                pointerEvents: isActive ? "auto" : "none",
                cursor: isActive ? "move" : "default",
                outline: isActive ? "1px dashed rgba(61,242,126,0.5)" : "none",
                userSelect: "none",
                touchAction: "none",
              }}
            />
          );
        })}
    </div>
  );
}
