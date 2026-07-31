"use client";

import { motion, useReducedMotion } from "motion/react";
import { GlitchChars } from "./GlitchChars";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT } from "@/lib/motion";

/**
 * Papéis voando de uma pasta aberta para uma fechada.
 *
 * Colhido de `visantlabs-os/src/components/ui/FlyingPaperLoader.tsx`. Entra aqui
 * porque é o único loader da casa que **descreve a operação** em vez de só
 * ocupar o tempo: ingerir uma pasta de mockups é literalmente mover arquivos de
 * uma pasta para outra. Um spinner genérico diz "espere"; isto diz o que está
 * acontecendo — e é a diferença entre esperar e acompanhar.
 *
 * Três mudanças em relação à origem, todas por SSoT:
 *  · `framer-motion` → `motion/react` (o pacote instalado aqui).
 *  · O hook de glitch inline virou `<GlitchChars />` — a mesma primitiva do
 *    registry, uma implementação só.
 *  · `bg-brand-cyan` → `bg-acc`: o acento cyan deste projeto (#22d3ee), que é o
 *    mesmo papel na paleta. Nenhum hex novo.
 *
 * `prefers-reduced-motion`: os papéis param no meio do voo (a cena continua
 * legível como ilustração) e a barra de progresso continua — ela é informação,
 * não animação.
 */

const LOOP_DURATION = 1.2;

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="40" height="34" viewBox="0 0 40 34" fill="none" aria-hidden="true">
      {open ? (
        <>
          <rect x="0" y="8" width="36" height="24" rx="1" fill="#F5D245" stroke="#BFA030" strokeWidth="1.5" />
          <path d="M0 8 L14 8 L17 3 L36 3 L36 8" fill="#F5D245" stroke="#BFA030" strokeWidth="1.5" />
          <rect x="0" y="8" width="36" height="4" rx="0" fill="#E8C630" />
        </>
      ) : (
        <>
          <rect x="2" y="10" width="36" height="22" rx="1" fill="#F5D245" stroke="#BFA030" strokeWidth="1.5" />
          <path d="M2 10 L16 10 L19 5 L38 5 L38 10" fill="#F5D245" stroke="#BFA030" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

function PaperIcon() {
  return (
    <svg width="20" height="24" viewBox="0 0 20 24" fill="none" aria-hidden="true">
      <path d="M1 1 H13 L19 7 V23 H1 Z" fill="#fff" stroke="#888" strokeWidth="1.2" />
      <path d="M13 1 V7 H19" fill="#ddd" stroke="#888" strokeWidth="1.2" />
      <line x1="4" y1="11" x2="16" y2="11" stroke="#ccc" strokeWidth="1" />
      <line x1="4" y1="14" x2="16" y2="14" stroke="#ccc" strokeWidth="1" />
      <line x1="4" y1="17" x2="12" y2="17" stroke="#ccc" strokeWidth="1" />
    </svg>
  );
}

export function FlyingPaperLoader({
  progress,
  label,
  className,
}: {
  /** 0–100. Ausente ⇒ indeterminado (só o voo + rótulo). */
  progress?: number;
  label?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const pct = progress == null ? null : Math.min(100, Math.max(0, progress));

  return (
    <div className={className}>
      <div className="relative w-[200px] h-[64px] mx-auto">
        <div className="absolute left-0 bottom-0">
          <FolderIcon open />
        </div>
        <div className="absolute right-0 bottom-0">
          <FolderIcon />
        </div>

        <div className="absolute inset-0 pointer-events-none">
          {[0, 0.35, 0.7].map((delay) => (
            <motion.div
              key={delay}
              className="absolute left-[14px] top-[6px]"
              initial={{ x: 0, y: 20, opacity: 0, rotate: -5 }}
              animate={
                reduced
                  ? { x: 75, y: -6, opacity: 1, rotate: -3 }
                  : {
                      x: [0, 50, 110, 150],
                      y: [20, -8, -4, 22],
                      opacity: [0, 1, 1, 0],
                      rotate: [-5, -18, 12, 5],
                    }
              }
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: LOOP_DURATION, repeat: Infinity, delay, ease: "easeInOut" }
              }
            >
              <PaperIcon />
            </motion.div>
          ))}
        </div>
      </div>

      <div className="mt-3 w-[200px] mx-auto">
        {pct != null && (
          <div className="h-[6px] rounded-full bg-neutral-800 overflow-hidden">
            <motion.div
              className="h-full bg-acc rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: DUR.slow, ease: EASE_OUT }}
            />
          </div>
        )}
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "text-[10px] font-mono text-neutral-500 text-center tabular-nums",
            pct != null && "mt-1.5",
          )}
        >
          <GlitchChars className="text-acc/60 mr-1" />
          {label || (pct != null ? `${Math.round(pct)}%` : "Processando…")}
        </p>
      </div>
    </div>
  );
}
