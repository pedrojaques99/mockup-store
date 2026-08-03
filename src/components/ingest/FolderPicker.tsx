"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, ArrowRight, Clock } from "lucide-react";
import { motion } from "motion/react";
import { transitions } from "@/lib/motion";

/**
 * Etapa da origem: de onde vêm os arquivos.
 *
 * Isto vivia num bloco espremido na sidebar (15% a 28% de largura), onde um
 * caminho real de 90 caracteres cabia em pedaços. Aqui tem a largura do diálogo,
 * que é o mínimo para o usuário LER o que digitou antes de mandar varrer.
 *
 * O campo aceita caminho absoluto porque o app roda local e quem varre é o
 * servidor, no mesmo host: nenhuma API de browser entrega caminho absoluto de
 * pasta. O seletor nativo e a validação ao vivo entram depois; o que existe
 * aqui já é o suficiente para o fluxo inteiro funcionar.
 */

const RECENTES_KEY = "mockup-store:ingest-recentes";
const MAX_RECENTES = 5;

export function lerRecentes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTES_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function gravarRecente(path: string) {
  if (typeof window === "undefined" || !path.trim()) return;
  try {
    const atual = lerRecentes().filter((p) => p !== path);
    window.localStorage.setItem(
      RECENTES_KEY,
      JSON.stringify([path, ...atual].slice(0, MAX_RECENTES)),
    );
  } catch {
    /* localStorage cheio ou bloqueado: recentes é conveniência, não pode quebrar o fluxo */
  }
}

export function FolderPicker({ onEscolher }: { onEscolher: (path: string) => void }) {
  const [valor, setValor] = useState("");
  const [recentes, setRecentes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentes(lerRecentes());
    inputRef.current?.focus();
  }, []);

  const seguir = (path: string) => {
    const limpo = path.trim();
    if (!limpo) return;
    gravarRecente(limpo);
    onEscolher(limpo);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitions.base}
      className="flex flex-col gap-8 px-6 sm:px-8 py-8"
    >
      <div className="w-full">
        <label
          htmlFor="ingest-folder"
          className="text-[10px] font-bold uppercase tracking-widest text-neutral-500"
        >
          Pasta com os mockups
        </label>
        {/* Empilha em telas estreitas: lado a lado, o botão saía para fora do
            diálogo (que tem overflow-hidden, então o corte era silencioso). */}
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3.5 py-3 focus-within:border-neutral-600">
            <FolderOpen className="w-4 h-4 text-neutral-600 shrink-0" aria-hidden />
            <input
              ref={inputRef}
              id="ingest-folder"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && seguir(valor)}
              placeholder="D:/Mockups/Campanha 2026"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-700 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => seguir(valor)}
            disabled={!valor.trim()}
            className="shrink-0 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-90 disabled:opacity-25"
          >
            Varrer
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
        <p className="mt-3 text-xs font-medium leading-relaxed text-neutral-600">
          O caminho é lido pelo servidor, que roda na sua máquina. Nada é gravado antes de você
          revisar o que entra. Duplicata e lixo já vêm desmarcados.
        </p>
      </div>

      {recentes.length > 0 && (
        <div className="w-full">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-600">
            <Clock className="w-3 h-3" aria-hidden />
            Recentes
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {recentes.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => seguir(p)}
                  title={p}
                  className="w-full truncate rounded-lg px-2.5 py-2 text-left font-mono text-[11px] text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
