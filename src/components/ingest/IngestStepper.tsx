"use client";

import { motion } from "motion/react";
import { transitions } from "@/lib/motion";

/**
 * Os cinco pontos do topo do ingest.
 *
 * Existe por uma razão só: o fluxo grava no acervo de forma irreversível, e o
 * usuário precisa saber quantas portas ainda existem entre ele e a escrita. Sem
 * isso, "Continuar" na etapa da origem parece que já vai gravar.
 *
 * Se isto crescer para além de cinco pontos e uma linha, virou decoração.
 */

export const PASSOS = ["Origem", "Varredura", "Aprovação", "Gravação", "Pronto"] as const;

export function IngestStepper({ atual }: { atual: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Etapas do ingest">
      {PASSOS.map((nome, i) => {
        const feito = i < atual;
        const agora = i === atual;
        return (
          <li key={nome} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <motion.span
                aria-hidden
                animate={{ scale: agora ? 1 : 0.7, opacity: feito || agora ? 1 : 0.35 }}
                transition={transitions.base}
                className={`w-1.5 h-1.5 rounded-full ${
                  feito || agora ? "bg-white" : "bg-neutral-600"
                }`}
              />
              <span
                className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  agora ? "text-white" : feito ? "text-neutral-500" : "text-neutral-700"
                }`}
                aria-current={agora ? "step" : undefined}
              >
                {nome}
              </span>
            </div>
            {i < PASSOS.length - 1 && (
              <span aria-hidden className="w-4 h-px bg-neutral-800" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
