"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, CornerLeftUp, HardDrive, Folder, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { transitions } from "@/lib/motion";

/**
 * Navegador de pastas do próprio app.
 *
 * É o caminho portátil: nenhuma API de browser entrega caminho absoluto de
 * pasta, e o seletor nativo do Windows só existe no Windows e atrás de flag.
 * Isto funciona em qualquer lugar, não abre janela do sistema e é testável.
 */

interface DirEntry {
  nome: string;
  caminho: string;
}

export function FolderBrowser({
  onEscolher,
  onCancelar,
}: {
  onEscolher: (path: string) => void;
  onCancelar: () => void;
}) {
  const [atual, setAtual] = useState<string | null>(null);
  const [pai, setPai] = useState<string | null>(null);
  const [pastas, setPastas] = useState<DirEntry[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const navegar = useCallback(async (path: string | null) => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setAtual(d.atual);
      setPai(d.pai);
      setPastas(d.pastas ?? []);
    } catch (e) {
      setErro(String((e as Error)?.message ?? e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    navegar(null);
  }, [navegar]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitions.fast}
      className="rounded-xl border border-neutral-800 bg-neutral-900/40"
    >
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <button
          type="button"
          onClick={() => navegar(pai)}
          disabled={!pai && !atual}
          title="Subir um nível"
          aria-label="Subir um nível"
          className="rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-25"
        >
          <CornerLeftUp className="h-3.5 w-3.5" />
        </button>
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-500" title={atual ?? "Unidades"}>
          {atual ?? "Unidades"}
        </p>
        {atual && (
          <button
            type="button"
            onClick={() => onEscolher(atual)}
            className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-90"
          >
            Usar esta
          </button>
        )}
      </div>

      <ul className="max-h-56 overflow-y-auto py-1">
        {carregando && (
          <li className="flex items-center gap-2 px-3 py-3 text-[11px] text-neutral-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Lendo…
          </li>
        )}
        {!carregando && erro && (
          <li className="px-3 py-3 text-[11px] text-amber-400">{erro}</li>
        )}
        {!carregando && !erro && pastas.length === 0 && (
          <li className="px-3 py-3 text-[11px] text-neutral-600">Nenhuma subpasta aqui.</li>
        )}
        {!carregando &&
          pastas.map((d) => (
            <li key={d.caminho}>
              <button
                type="button"
                onClick={() => navegar(d.caminho)}
                onDoubleClick={() => onEscolher(d.caminho)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {atual ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-600" aria-hidden />
                ) : (
                  <HardDrive className="h-3.5 w-3.5 shrink-0 text-neutral-600" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{d.nome}</span>
                <ChevronRight className="h-3 w-3 shrink-0 text-neutral-700" aria-hidden />
              </button>
            </li>
          ))}
      </ul>

      <div className="border-t border-neutral-800 px-3 py-2">
        <button
          type="button"
          onClick={onCancelar}
          className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 transition-colors hover:text-neutral-300"
        >
          Fechar
        </button>
      </div>
    </motion.div>
  );
}
