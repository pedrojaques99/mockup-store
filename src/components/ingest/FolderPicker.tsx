"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  ArrowRight,
  Clock,
  Check,
  AlertTriangle,
  Loader2,
  FolderSearch,
  MonitorUp,
  CloudOff,
} from "lucide-react";
import { motion } from "motion/react";
import { transitions } from "@/lib/motion";
import { FolderBrowser } from "./FolderBrowser";

/**
 * Etapa da origem: de onde vêm os arquivos.
 *
 * Isto vivia num bloco espremido na sidebar (15% a 28% de largura), onde um
 * caminho real de 90 caracteres cabia em pedaços. Aqui tem a largura do diálogo,
 * que é o mínimo para o usuário LER o que digitou antes de mandar varrer.
 *
 * Três portas para a mesma coisa, porque nenhuma sozinha cobre todo mundo:
 * colar ou digitar (com validação ao vivo), o navegador de pastas do app
 * (portátil), e o seletor nativo do Windows (atrás de flag). Colar link do
 * Drive resolve para caminho local sem credencial nenhuma.
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

const ehUrlDrive = (s: string) => /drive\.google\.com/i.test(s);

interface Estado {
  tipo: "vazio" | "checando" | "ok" | "erro";
  entradas?: number;
  naNuvem?: number;
  mensagem?: string;
}

export function FolderPicker({ onEscolher }: { onEscolher: (path: string) => void }) {
  const [valor, setValor] = useState("");
  const [recentes, setRecentes] = useState<string[]>([]);
  const [estado, setEstado] = useState<Estado>({ tipo: "vazio" });
  const [navegando, setNavegando] = useState(false);
  const [abrindoNativo, setAbrindoNativo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentes(lerRecentes());
    inputRef.current?.focus();
  }, []);

  // Validação ao vivo. Antes o usuário só descobria que errou o caminho depois
  // de mandar varrer e tomar um 404 na cara.
  useEffect(() => {
    const bruto = valor.trim();
    if (!bruto) {
      setEstado({ tipo: "vazio" });
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setEstado({ tipo: "checando" });
      try {
        if (ehUrlDrive(bruto)) {
          const res = await fetch(`/api/fs/drive?url=${encodeURIComponent(bruto)}`, {
            signal: ac.signal,
          });
          const d = await res.json();
          if (d.ok && d.caminho) {
            // Resolveu: troca o link pelo caminho e revalida no próximo ciclo.
            setValor(d.caminho);
            return;
          }
          setEstado({ tipo: "erro", mensagem: d.motivo ?? "Não deu para resolver esse link." });
          return;
        }
        const res = await fetch(`/api/fs/stat?path=${encodeURIComponent(bruto)}`, {
          signal: ac.signal,
        });
        const d = await res.json();
        if (!d.existe) {
          setEstado({ tipo: "erro", mensagem: "Essa pasta não existe nesta máquina." });
        } else if (!d.ehPasta) {
          setEstado({ tipo: "erro", mensagem: "Isso é um arquivo, não uma pasta." });
        } else {
          setEstado({ tipo: "ok", entradas: d.entradas, naNuvem: d.naNuvem });
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setEstado({ tipo: "erro", mensagem: "Não deu para checar o caminho." });
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [valor]);

  const seguir = (path: string) => {
    const limpo = path.trim().replace(/\\/g, "/");
    if (!limpo) return;
    gravarRecente(limpo);
    onEscolher(limpo);
  };

  const abrirNativo = async () => {
    setAbrindoNativo(true);
    try {
      const res = await fetch("/api/fs/pick-folder", { method: "POST" });
      const d = await res.json();
      if (d.caminho) setValor(d.caminho);
      else if (d.error) setEstado({ tipo: "erro", mensagem: d.error });
    } catch {
      setEstado({ tipo: "erro", mensagem: "Não deu para abrir o seletor do Windows." });
    } finally {
      setAbrindoNativo(false);
    }
  };

  const podeSeguir = estado.tipo === "ok";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitions.base}
      className="flex flex-col gap-6 px-6 sm:px-8 py-8"
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
              onKeyDown={(e) => e.key === "Enter" && podeSeguir && seguir(valor)}
              placeholder="D:/Mockups/Campanha 2026 ou link do Drive"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={estado.tipo === "erro"}
              aria-describedby="ingest-folder-estado"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-700 outline-none"
            />
            {estado.tipo === "checando" && (
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-neutral-600" aria-hidden />
            )}
            {estado.tipo === "ok" && (
              <Check className="w-3.5 h-3.5 shrink-0 text-acc2" aria-hidden />
            )}
            {estado.tipo === "erro" && (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden />
            )}
          </div>
          <button
            type="button"
            onClick={() => seguir(valor)}
            disabled={!podeSeguir}
            className="shrink-0 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-90 disabled:opacity-25"
          >
            Varrer
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>

        {/* Uma linha de estado que fala, em vez de um campo mudo até o 404. */}
        <p
          id="ingest-folder-estado"
          role="status"
          className={`mt-2 min-h-[1.25rem] text-xs font-medium leading-relaxed ${
            estado.tipo === "erro" ? "text-amber-400" : "text-neutral-600"
          }`}
        >
          {estado.tipo === "ok" && (
            <>
              Pasta encontrada, {estado.entradas} {estado.entradas === 1 ? "item" : "itens"} no
              primeiro nível.
            </>
          )}
          {estado.tipo === "erro" && estado.mensagem}
          {estado.tipo === "checando" && "Checando…"}
          {estado.tipo === "vazio" &&
            "O caminho é lido pelo servidor, que roda na sua máquina. Nada é gravado antes de você revisar o que entra."}
        </p>

        {/* O aviso que não existia em lugar nenhum: a varredura lê os primeiros
            bytes de cada arquivo, e num arquivo que o Drive deixou só na nuvem
            isso dispara o download. Em pasta grande é a diferença entre minutos
            e horas. */}
        {estado.tipo === "ok" && (estado.naNuvem ?? 0) > 0 && (
          <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300">
            <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {estado.naNuvem} {estado.naNuvem === 1 ? "arquivo ainda não está baixado" : "arquivos ainda não estão baixados"} do
              Drive. A varredura vai baixar, e isso pode demorar bem mais que o normal.
            </span>
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setNavegando((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500 transition-colors hover:border-neutral-600 hover:text-white"
          >
            <FolderSearch className="h-3 w-3" aria-hidden />
            Procurar pasta
          </button>
          <button
            type="button"
            onClick={abrirNativo}
            disabled={abrindoNativo}
            title="Abre o seletor de pastas do Windows. Precisa de INGEST_NATIVE_PICKER=1 no .env.local."
            className="flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500 transition-colors hover:border-neutral-600 hover:text-white disabled:opacity-40"
          >
            {abrindoNativo ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <MonitorUp className="h-3 w-3" aria-hidden />
            )}
            Seletor do Windows
          </button>
        </div>

        {navegando && (
          <div className="mt-3">
            <FolderBrowser
              onEscolher={(p) => {
                setValor(p);
                setNavegando(false);
              }}
              onCancelar={() => setNavegando(false)}
            />
          </div>
        )}
      </div>

      {recentes.length > 0 && !navegando && (
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
                  onClick={() => setValor(p)}
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
