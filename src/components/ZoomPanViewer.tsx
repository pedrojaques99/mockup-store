"use client";

/**
 * ZoomPanViewer — lightweight image zoom / pan / pinch viewer.
 * Wheel zooms toward the cursor, drag pans (clamped so the image never
 * leaves the frame), two-finger pinch on touch. Renders its own zoom HUD.
 * Replaces react-zoom-pan-pinch (whose sizing model fought our layout).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_STEP = 0.0015; // per deltaY unit
const BTN_STEP = 0.6;      // per button press

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function ZoomPanViewer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null);

  // Clamp translation so the scaled content can't drift outside the frame.
  const clampPan = useCallback((nx: number, ny: number, s: number) => {
    const c = containerRef.current, content = contentRef.current;
    if (!c || !content) return { x: nx, y: ny };
    const cw = c.clientWidth, ch = c.clientHeight;
    const sw = content.offsetWidth * s, sh = content.offsetHeight * s;
    const maxX = Math.max(0, (sw - cw) / 2);
    const maxY = Math.max(0, (sh - ch) / 2);
    return { x: clamp(nx, -maxX, maxX), y: clamp(ny, -maxY, maxY) };
  }, []);

  // Zoom around a screen point (keeps the content point under the cursor fixed).
  const applyZoom = useCallback((nextScale: number, px: number, py: number) => {
    const c = containerRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const cx = px - (rect.left + rect.width / 2);
    const cy = py - (rect.top + rect.height / 2);
    const s = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const ratio = s / scale;
    const nx = cx - (cx - tx) * ratio;
    const ny = cy - (cy - ty) * ratio;
    const { x, y } = clampPan(nx, ny, s);
    setScale(s);
    setTx(s === 1 ? 0 : x);
    setTy(s === 1 ? 0 : y);
  }, [scale, tx, ty, clampPan]);

  // Native non-passive wheel listener so we can preventDefault.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * WHEEL_STEP);
      applyZoom(scale * factor, e.clientX, e.clientY);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [applyZoom, scale]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      drag.current = null;
    } else if (scale > 1) {
      drag.current = { x: e.clientX, y: e.clientY, tx, ty };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = pinch.current.scale * (dist / pinch.current.dist);
      applyZoom(next, pinch.current.cx, pinch.current.cy);
      return;
    }

    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      const { x, y } = clampPan(drag.current.tx + dx, drag.current.ty + dy, scale);
      setTx(x); setTy(y);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  const reset = () => { setScale(1); setTx(0); setTy(0); };

  const center = () => {
    const c = containerRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  return (
    <div className={["relative w-full h-full overflow-hidden", className].join(" ")}>
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center touch-none"
        style={{ cursor: scale > 1 ? (drag.current ? "grabbing" : "grab") : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => applyZoom(scale > 1 ? 1 : 2.5, e.clientX, e.clientY)}
      >
        <div
          ref={contentRef}
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: drag.current || pinch.current ? "none" : "transform 0.12s ease-out",
            willChange: "transform",
          }}
        >
          {children}
        </div>
      </div>

      {/* Zoom HUD */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1.5 border border-zinc-700/50">
        <button
          onClick={() => { const p = center(); applyZoom(scale - BTN_STEP, p.x, p.y); }}
          className="text-zinc-400 hover:text-white p-1.5 transition-colors rounded-full hover:bg-white/10"
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={reset}
          className="text-zinc-500 hover:text-white text-[10px] px-2 font-mono transition-colors min-w-[3ch]"
          title="Reset"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={() => { const p = center(); applyZoom(scale + BTN_STEP, p.x, p.y); }}
          className="text-zinc-400 hover:text-white p-1.5 transition-colors rounded-full hover:bg-white/10"
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
        <span className="w-px h-3.5 bg-zinc-700 mx-1" />
        <button
          onClick={reset}
          className="text-zinc-400 hover:text-white p-1.5 transition-colors rounded-full hover:bg-white/10"
          title="Fit"
        >
          <Maximize size={12} />
        </button>
      </div>
    </div>
  );
}
