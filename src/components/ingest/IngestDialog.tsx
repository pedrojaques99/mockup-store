"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderPlus,
  Layers,
  Search,
  Import,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { IngestStepper } from "./IngestStepper";
import { FolderPicker } from "./FolderPicker";
import { FlyingPaperLoader } from "@/components/ui/FlyingPaperLoader";
import { GlitchChars } from "@/components/ui/GlitchChars";
import { transitions } from "@/lib/motion";
import type { TriagedItem, TriageSummary, Verdict } from "@/lib/ingest-triage";

/**
 * Revisão do ingest — a tela que decide o que entra no acervo.
 *
 * É uma superfície de **trust**: a escrita é irreversível pelo produto (limpar
 * depois é `scripts/remove-dupes.ps1` na mão). O anterior pedia confirmação em
 * cima de duas contagens; aqui o usuário vê arquivo, miniatura, motivo e pode
 * desmarcar item a item antes de qualquer escrita.
 *
 * O default é a estratégia: vem marcado só o que o pré-voo classificou como
 * NOVO. Duplicata, lixo e o que já está no acervo entram desmarcados, visíveis e
 * com o motivo escrito — nunca escondidos. Esconder seria decidir pelo usuário
 * uma coisa que às vezes ele quer mesmo (aquele "thumbnail" pode ser a única
 * versão que sobrou).
 */

type Phase = "origin" | "scanning" | "review" | "ingesting" | "done" | "error";

/** Fase → ponto aceso no stepper. Varredura e revisão são etapas distintas. */
const PASSO_DA_FASE: Record<Phase, number> = {
  origin: 0,
  scanning: 1,
  review: 2,
  ingesting: 3,
  done: 4,
  error: 1,
};

const VERDICT_META: Record<
  Verdict,
  { label: string; short: string; dot: string; text: string; bg: string }
> = {
  new: {
    label: "Novos",
    short: "Novo",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
  duplicate: {
    label: "Duplicatas",
    short: "Duplicata",
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  junk: {
    label: "Lixo",
    short: "Lixo",
    dot: "bg-red-500",
    text: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  exists: {
    label: "Já no acervo",
    short: "Já existe",
    dot: "bg-neutral-600",
    text: "text-neutral-500",
    bg: "bg-neutral-800/40 border-neutral-700/40",
  },
};

const VERDICT_ORDER: Verdict[] = ["new", "duplicate", "junk", "exists"];

type Campo = "nome" | "tamanho" | "veredito";

/**
 * Altura de uma linha da aprovação, em px. É constante de propósito: a lista é
 * virtualizada e uma altura fixa evita medir cada linha, que numa pasta de
 * milhares de itens custa mais que renderizar.
 */
const ALTURA_LINHA = 56;

/** Onde a sessão de revisão fica guardada para sobreviver a um F5. */
const SESSAO_KEY = "mockup-store:ingest-sessao";

const fmtBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

interface IngestReport {
  referencesCreated: number;
  psdOnlyCreated: number;
  referencesSkipped: number;
  psdMetadataScanned: number;
  errors: string[];
  /** Parou no meio: o que entrou continua no acervo. */
  cancelled?: boolean;
}

export default function IngestDialog({
  open,
  onClose,
  onIngested,
}: {
  open: boolean;
  onClose: () => void;
  /** Chamado depois de um commit bem-sucedido: o grid precisa recarregar. */
  onIngested: (report: IngestReport) => void;
}) {
  // A pasta agora é escolhida DENTRO do diálogo. Antes vinha de um campo na
  // sidebar, e o fluxo trocava de container no meio do caminho: etapa da origem
  // num painel de 15% de largura, o resto num diálogo por cima.
  const [folderPath, setFolderPath] = useState("");
  const [phase, setPhase] = useState<Phase>("origin");
  const [items, setItems] = useState<TriagedItem[]>([]);
  const [summary, setSummary] = useState<TriageSummary | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [studio, setStudio] = useState("");
  const [filter, setFilter] = useState<Verdict | "all">("all");
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<{ pct: number; done: number; total: number; currentFile: string } | null>(null);
  /** Fase da listagem: só existe contagem, ainda não existe total. */
  const [listing, setListing] = useState<{ found: number; dir: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<IngestReport | null>(null);
  /** Ordenação da lista de aprovação. */
  const [ordem, setOrdem] = useState<{ campo: Campo; asc: boolean }>({ campo: "nome", asc: true });
  /** Escape do estado "já está tudo no acervo": ver a lista assim mesmo. */
  const [verTudo, setVerTudo] = useState(false);
  /**
   * Ref por ESTADO, não useRef. O container da lista só monta na fase de
   * revisão, e um `useRef` ainda estava nulo quando o virtualizer mediu: ele
   * devolvia zero linhas para uma lista de 150 itens, com o rodapé anunciando
   * "Ingerir 150" e a tela vazia. Guardar o elemento em estado força um render
   * novo no momento em que ele existe.
   */
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ── Pré-voo ───────────────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/ingest-folder/scan?stream=1&path=${encodeURIComponent(folderPath)}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Sem corpo de resposta");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "listing") {
            // Fase da listagem: ainda não existe denominador (o total nasce
            // quando ela termina). Contar o que já apareceu é progresso honesto;
            // uma barra em porcentagem aqui seria invenção.
            setListing({ found: Number(ev.found) || 0, dir: String(ev.dir ?? "") });
          } else if (ev.type === "progress") {
            setListing(null);
            setProgress({
              pct: Number(ev.pct) || 0,
              done: Number(ev.done) || 0,
              total: Number(ev.total) || 0,
              currentFile: String(ev.currentFile ?? ""),
            });
          } else if (ev.type === "complete") {
            setListing(null);
            const list = (ev.items as TriagedItem[]) ?? [];
            setItems(list);
            setSummary(ev.summary as TriageSummary);
            setDegraded(Boolean(ev.degraded));
            setStudio(String(ev.folder ?? ""));
            setSelected(new Set(list.filter((i) => i.verdict === "new").map((i) => i.path)));
            setPhase("review");
          } else if (ev.type === "error") {
            throw new Error(String(ev.message));
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(String((err as Error)?.message ?? err));
      setPhase("error");
    }
  }, [folderPath]);

  /**
   * Re-scan explícito (botão "escanear de novo"). Os resets vivem AQUI e não
   * dentro de `runScan` porque, na montagem, o estado já nasce em `scanning`
   * com tudo vazio — zerar de novo só produziria um render em cascata.
   */
  const rescan = useCallback(() => {
    setPhase("scanning");
    setError(null);
    setItems([]);
    setProgress(null);
    runScan();
  }, [runScan]);

  useEffect(() => {
    // Só varre depois que a pasta foi escolhida na etapa da origem.
    if (!folderPath) return;
    // `runScan` não escreve estado nenhum de forma síncrona: tudo acontece
    // depois do primeiro `await`, nos eventos que chegam do stream SSE — que é
    // exatamente o caso que a documentação da regra chama de "subscrever a um
    // sistema externo". O lint não enxerga o `await` atravessando o useCallback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runScan();
    return () => abortRef.current?.abort();
  }, [runScan, folderPath]);

  /**
   * Retomada. A triagem custa minutos numa pasta grande (hash de cada arquivo),
   * e fechar o diálogo no meio da aprovação jogava tudo fora: reabrir mandava
   * varrer de novo do zero. Agora a revisão sobrevive a fechar e a um F5.
   *
   * Fica em `sessionStorage` de propósito: é estado de trabalho de uma sessão,
   * não preferência. Só a revisão é guardada — varredura e gravação em
   * andamento não podem "retomar", porque o servidor já parou.
   */
  useEffect(() => {
    if (phase !== "review" || !items.length) return;
    try {
      sessionStorage.setItem(
        SESSAO_KEY,
        JSON.stringify({ folderPath, items, summary, degraded, studio, selecionados: [...selected] }),
      );
    } catch {
      /* cota estourada numa pasta enorme: retomar é conveniência, não pode quebrar */
    }
  }, [phase, items, summary, degraded, studio, selected, folderPath]);

  /** Ao abrir, oferece continuar de onde parou em vez de varrer de novo. */
  useEffect(() => {
    if (!open || phase !== "origin" || items.length) return;
    try {
      const raw = sessionStorage.getItem(SESSAO_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s?.folderPath || !Array.isArray(s.items) || !s.items.length) return;
      setFolderPath(s.folderPath);
      setItems(s.items);
      setSummary(s.summary ?? null);
      setDegraded(Boolean(s.degraded));
      setStudio(String(s.studio ?? ""));
      setSelected(new Set<string>(Array.isArray(s.selecionados) ? s.selecionados : []));
      setPhase("review");
    } catch {
      /* sessão corrompida: começa do zero, que é o comportamento antigo */
    }
    // Só na abertura; depois disso quem manda é o usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Volta para a origem sem fechar: ingerir pasta raramente é uma pasta só. */
  const recomecar = useCallback(() => {
    setFolderPath("");
    setItems([]);
    setSummary(null);
    setSelected(new Set());
    setReport(null);
    setProgress(null);
    setListing(null);
    setError(null);
    setQuery("");
    setFilter("all");
    setVerTudo(false);
    setPhase("origin");
  }, []);

  /** Mostra o arquivo no Explorer, para decidir olhando e não adivinhando. */
  const revelar = useCallback((path: string) => {
    fetch("/api/open-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, mode: "reveal" }),
    }).catch(() => {});
  }, []);

  /** Escolheu a pasta: sai da origem e entra na varredura. */
  const escolherPasta = useCallback((path: string) => {
    setFolderPath(path);
    setPhase("scanning");
    setItems([]);
    setProgress(null);
    setListing(null);
    setError(null);
  }, []);

  // ── Commit ────────────────────────────────────────────────────────────────
  const commit = useCallback(async () => {
    const files = items
      .filter((i) => selected.has(i.path))
      .map((i) => ({
        path: i.path,
        name: i.name,
        ext: i.ext,
        sizeBytes: i.sizeBytes,
        studio: studio.trim() || i.studio,
      }));
    if (!files.length) return;

    setPhase("ingesting");
    setProgress({ pct: 0, done: 0, total: files.length, currentFile: "" });
    setError(null);
    // O commit não tinha AbortController nenhum: desmontar durante a gravação
    // deixava o servidor escrevendo no Mongo para ninguém. O scan já abortava.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/ingest-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath, files, studio: studio.trim() || undefined, stream: true }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Sem corpo de resposta");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "progress") {
            setProgress({
              pct: Number(ev.pct) || 0,
              done: Number(ev.done) || 0,
              total: Number(ev.total) || 0,
              currentFile: String(ev.detail ?? ""),
            });
          } else if (ev.type === "complete") {
            const rep = ev as unknown as IngestReport;
            setReport(rep);
            setPhase("done");
            // Gravou: a sessão cumpriu o papel. Deixá-la faria o próximo abrir
            // oferecer "continuar" uma revisão que já entrou no acervo.
            try {
              sessionStorage.removeItem(SESSAO_KEY);
            } catch {
              /* sem sessionStorage: nada a limpar */
            }
            onIngested(rep);
          } else if (ev.type === "error") {
            throw new Error(String(ev.message));
          }
        }
      }
    } catch (err) {
      // Cancelar é escolha do usuário, não falha para mostrar em vermelho.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(String((err as Error)?.message ?? err));
      setPhase("error");
    }
  }, [items, selected, studio, folderPath, onIngested]);

  // ── Derivados ─────────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtrados = items.filter((i) => {
      if (filter !== "all" && i.verdict !== filter) return false;
      if (q && !i.name.toLowerCase().includes(q) && !i.path.toLowerCase().includes(q)) return false;
      return true;
    });
    // Ordenação em memória: a lista já está inteira no cliente, então ordenar
    // aqui é mais barato e mais previsível que um round-trip.
    const dir = ordem.asc ? 1 : -1;
    return [...filtrados].sort((a, b) => {
      switch (ordem.campo) {
        case "tamanho":
          return (a.sizeBytes - b.sizeBytes) * dir;
        case "veredito": {
          const d = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict);
          return (d || a.name.localeCompare(b.name, "pt-BR")) * dir;
        }
        default:
          return a.name.localeCompare(b.name, "pt-BR", { numeric: true }) * dir;
      }
    });
  }, [items, filter, query, ordem]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroller,
    estimateSize: () => ALTURA_LINHA,
    overscan: 8,
  });

  /** Novos no acervo INTEIRO, não só no recorte à vista. */
  const marcaveisTotais = useMemo(
    () => items.filter((i) => i.verdict === "new").length,
    [items],
  );

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.path)),
    [items, selected],
  );
  const selectedBytes = useMemo(
    () => selectedItems.reduce((s, i) => s + i.sizeBytes, 0),
    [selectedItems],
  );

  const toggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /**
   * O que "marcar à vista" realmente marca.
   *
   * Sem filtro, marca só o que a triagem chamou de NOVO. Marcar tudo aqui era a
   * jogada ótima do usuário apressado e desfazia em um clique a única proteção
   * do fluxo: duplicata, lixo e o que já está no acervo vêm desmarcados de
   * propósito, e a escrita é irreversível pelo produto.
   *
   * Com filtro aplicado, marca tudo que está à vista, porque aí o usuário foi
   * ATRÁS daquele veredito. Filtrar por "Lixo" e mandar marcar é escolha
   * declarada, não descuido.
   */
  const marcaveis = useMemo(
    () => (filter === "all" ? visible.filter((i) => i.verdict === "new") : visible),
    [visible, filter],
  );

  const setManyVisible = useCallback(
    (on: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        // Desmarcar vale para tudo à vista; marcar respeita a triagem.
        for (const i of on ? marcaveis : visible) {
          if (on) next.add(i.path);
          else next.delete(i.path);
        }
        return next;
      });
    },
    [visible, marcaveis],
  );

  const allVisibleSelected = marcaveis.length > 0 && marcaveis.every((i) => selected.has(i.path));
  /** Quantos itens à vista ficariam de fora ao marcar, para o botão não mentir. */
  const foraDaMarcacao = visible.length - marcaveis.length;

  // Esc fecha; ⌘A / Ctrl+A marca o que está à vista (e não a página inteira do
  // navegador). Só quando o foco não está num campo de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "Escape" && phase !== "ingesting") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !typing && phase === "review") {
        e.preventDefault();
        setManyVisible(!allVisibleSelected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase, setManyVisible, allVisibleSelected]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && phase !== "ingesting") onClose(); }}>
      <DialogContent title="Adicionar pasta ao acervo" skin="neutral" showClose={false} bare
        className="flex items-center justify-center p-4"
        onEscapeKeyDown={(e) => { if (phase === "ingesting") e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (phase === "ingesting") e.preventDefault(); }}
      >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={transitions.base}
        // A altura acompanha a etapa. A origem é um campo e um parágrafo; forçar
        // 88vh nela deixava o conteúdo boiando no meio de um vazio enorme. A
        // revisão, essa sim, precisa de toda a altura para a lista.
        className={`relative w-full bg-neutral-950 border border-neutral-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl ${
          phase === "origin" ? "max-w-2xl" : "max-w-5xl h-[88vh]"
        }`}
      >
        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/30 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-acc/15 flex items-center justify-center shrink-0">
              <FolderPlus className="w-4 h-4 text-acc" />
            </div>
            <div className="min-w-0">
              {/* `text-nowrap`: com o stepper na mesma linha e o diálogo estreito
                  da etapa da origem, o título quebrava em quatro linhas e o
                  subtítulo virava "Esc…". Por isso o stepper saiu daqui. */}
              <h3 className="text-sm font-black tracking-tight text-nowrap">
                Adicionar pasta ao acervo
              </h3>
              <p className="text-[10px] text-neutral-600 font-mono truncate mt-0.5">
                {folderPath || "Escolha de onde vêm os arquivos"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={phase === "ingesting"}
            title={phase === "ingesting" ? "Aguarde o ingest terminar" : "Fechar (Esc)"}
            className="p-1.5 rounded-xl hover:bg-neutral-800 text-neutral-600 hover:text-white transition-[color,background-color] active:scale-[0.97] disabled:opacity-30 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Faixa do stepper, em linha própria. Disputar a linha do título fazia
            os dois perderem: o título quebrava e o stepper apertava. */}
        <div className="px-6 py-2.5 border-b border-neutral-800 bg-neutral-900/10 shrink-0 overflow-x-auto no-scrollbar">
          <IngestStepper atual={PASSO_DA_FASE[phase]} />
        </div>

        {/* ── Corpo ── */}
        <div className="flex-1 min-h-0 flex flex-col">
          <AnimatePresence mode="wait">
            {phase === "origin" && (
              <FolderPicker key="origin" onEscolher={escolherPasta} />
            )}

            {(phase === "scanning" || phase === "ingesting") && (
              <motion.div
                key="working"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fast}
                className="flex-1 flex flex-col items-center justify-center gap-6 px-8"
              >
                {/* Enquanto está listando não existe denominador, então não vai
                    porcentagem: o loader roda indeterminado e o número que
                    aparece é o de arquivos achados até agora, que é verdade. */}
                <FlyingPaperLoader
                  progress={listing ? undefined : progress?.pct}
                  label={
                    listing
                      ? `Lendo a pasta, ${listing.found} ${listing.found === 1 ? "arquivo" : "arquivos"}`
                      : phase === "scanning"
                        ? progress
                          ? `Analisando ${progress.done}/${progress.total}`
                          : "Lendo a pasta…"
                        : progress
                          ? `Ingerindo ${progress.done}/${progress.total}`
                          : "Preparando…"
                  }
                />
                <p className="text-[10px] font-mono text-neutral-700 truncate max-w-md text-center h-4">
                  {listing ? listing.dir : progress?.currentFile}
                </p>
                <p className="text-[11px] text-neutral-600 font-bold uppercase tracking-widest text-center max-w-sm">
                  {phase === "scanning"
                    ? "Nada foi gravado ainda. Isto é o pré-voo"
                    : "Gravando no acervo"}
                </p>
              </motion.div>
            )}

            {phase === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fast}
                className="flex-1 flex flex-col items-center justify-center gap-4 px-8"
              >
                <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-400" />
                </div>
                <p className="text-red-400 text-xs font-bold text-center max-w-md break-words">{error}</p>
                <button
                  onClick={rescan}
                  className="h-10 px-4 rounded-xl bg-white text-black text-[11px] font-black uppercase tracking-widest hover:bg-neutral-200 transition-colors active:scale-[0.98]"
                >
                  Escanear de novo
                </button>
              </motion.div>
            )}

            {phase === "done" && report && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={transitions.base}
                className="flex-1 flex flex-col items-center justify-center gap-5 px-8"
              >
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-black text-white uppercase tracking-widest">
                    {report.cancelled ? "Interrompido" : "Ingest concluído"}
                  </p>
                  {report.cancelled && (
                    <p className="text-[11px] font-bold text-amber-400 mt-2">
                      Você parou no meio. O que já tinha entrado continua no acervo.
                    </p>
                  )}
                  <p className="text-[11px] font-bold text-neutral-500 mt-2">
                    {report.referencesCreated + report.psdOnlyCreated} itens no acervo,{" "}
                    {report.psdMetadataScanned} PSDs analisados
                    {report.referencesSkipped > 0 && `, ${report.referencesSkipped} já existiam`}
                  </p>
                </div>
                {report.errors?.length > 0 && (
                  <div className="w-full max-w-md max-h-32 overflow-y-auto rounded-xl bg-red-500/5 border border-red-500/15 p-3 space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-red-400">
                      {report.errors.length} com problema
                    </p>
                    {report.errors.slice(0, 20).map((e, i) => (
                      <p key={i} className="text-[10px] font-mono text-neutral-500 break-all">
                        {e}
                      </p>
                    ))}
                  </div>
                )}
                {/* Duas saídas, porque ingerir pasta raramente é uma pasta só:
                    antes o único caminho era fechar e recomeçar do gatilho. */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={recomecar}
                    className="h-10 px-4 rounded-xl border border-neutral-800 text-[11px] font-black uppercase tracking-widest text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors active:scale-[0.97]"
                  >
                    Adicionar outra pasta
                  </button>
                  <button
                    onClick={onClose}
                    className="h-10 px-6 rounded-xl bg-white text-black text-[11px] font-black uppercase tracking-widest hover:bg-neutral-200 transition-colors active:scale-[0.98]"
                  >
                    Ver no acervo
                  </button>
                </div>
              </motion.div>
            )}

            {/* Dois becos sem saída que caíam na tela de revisão vazia, sem
                explicar nada e ainda oferecendo um "Ingerir" impossível. Cada um
                merece resposta própria e um caminho de volta. */}
            {phase === "review" && summary && items.length === 0 && (
              <motion.div
                key="vazia"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transitions.base}
                className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center"
              >
                <Search className="w-8 h-8 text-neutral-800" aria-hidden />
                <div>
                  <p className="text-sm font-black uppercase tracking-widest text-neutral-400">
                    Nada aproveitável nesta pasta
                  </p>
                  <p className="mt-2 text-xs font-medium text-neutral-600">
                    Não achei PSD nem imagem em{" "}
                    <span className="font-mono text-neutral-500">{folderPath}</span>. Talvez os
                    arquivos estejam numa subpasta mais funda que cinco níveis.
                  </p>
                </div>
                <button
                  onClick={recomecar}
                  className="h-10 px-5 rounded-xl bg-white text-black text-[11px] font-black uppercase tracking-widest hover:bg-neutral-200 transition-colors active:scale-[0.98]"
                >
                  Escolher outra pasta
                </button>
              </motion.div>
            )}

            {phase === "review" && summary && items.length > 0 && marcaveisTotais === 0 && !verTudo && (
              <motion.div
                key="ja-no-acervo"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transitions.base}
                className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center"
              >
                <CheckCircle2 className="w-8 h-8 text-emerald-500/60" aria-hidden />
                <div>
                  <p className="text-sm font-black uppercase tracking-widest text-neutral-400">
                    Esta pasta já está toda no acervo
                  </p>
                  <p className="mt-2 text-xs font-medium text-neutral-600">
                    Os {items.length} arquivos são duplicata, lixo ou já foram ingeridos. Nada novo
                    para gravar.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setFilter("all");
                      setVerTudo(true);
                    }}
                    className="h-10 px-4 rounded-xl border border-neutral-800 text-[11px] font-black uppercase tracking-widest text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors active:scale-[0.97]"
                  >
                    Ver mesmo assim
                  </button>
                  <button
                    onClick={recomecar}
                    className="h-10 px-5 rounded-xl bg-white text-black text-[11px] font-black uppercase tracking-widest hover:bg-neutral-200 transition-colors active:scale-[0.98]"
                  >
                    Escolher outra pasta
                  </button>
                </div>
              </motion.div>
            )}

            {phase === "review" && summary && items.length > 0 && (marcaveisTotais > 0 || verTudo) && (
              <motion.div
                key="review"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fast}
                className="flex-1 min-h-0 flex flex-col"
              >
                {degraded && (
                  <div className="mx-6 mt-4 flex items-center gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <p className="text-[10px] font-bold text-amber-300">
                      Não deu para consultar o acervo, então o cruzamento com o que já existe
                      está incompleto. Duplicata contra itens já ingeridos pode passar.
                    </p>
                  </div>
                )}

                {/* Resumo + filtro por veredito. Contagem zero não renderiza. */}
                <div className="px-6 pt-4 pb-3 flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFilter("all")}
                    aria-pressed={filter === "all"}
                    className={`h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-widest transition-[color,background-color,border-color] active:scale-[0.97] ${
                      filter === "all"
                        ? "bg-white text-black border-white"
                        : "bg-neutral-900 border-neutral-800 text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    Tudo {summary.total}
                  </button>
                  {VERDICT_ORDER.filter((v) => summary[v] > 0).map((v) => {
                    const m = VERDICT_META[v];
                    const on = filter === v;
                    return (
                      <button
                        key={v}
                        onClick={() => setFilter(on ? "all" : v)}
                        aria-pressed={on}
                        className={`h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-[color,background-color,border-color] active:scale-[0.97] ${
                          on ? "bg-white text-black border-white" : `${m.bg} ${m.text}`
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-black" : m.dot}`} />
                        {m.label} {summary[v]}
                      </button>
                    );
                  })}
                  {summary.skippedBytes > 0 && (
                    <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest ml-auto">
                      {fmtBytes(summary.skippedBytes)} de lixo/duplicata fora
                    </span>
                  )}
                </div>

                {/* Ferramentas: busca, estúdio, marcar tudo */}
                <div className="px-6 pb-3 flex items-center gap-3 shrink-0">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filtrar por nome ou caminho…"
                      className="w-full h-9 rounded-xl bg-neutral-900 border border-neutral-800 pl-9 pr-4 text-xs focus:outline-none focus:border-neutral-600 transition-colors placeholder:text-neutral-700"
                    />
                  </div>
                  <label className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] font-black uppercase tracking-widest text-neutral-600">
                      Estúdio
                    </span>
                    <input
                      value={studio}
                      onChange={(e) => setStudio(e.target.value)}
                      placeholder="pasta"
                      className="w-40 h-9 rounded-xl bg-neutral-900 border border-neutral-800 px-3 text-xs font-bold focus:outline-none focus:border-neutral-600 transition-colors"
                    />
                  </label>
                  <button
                    onClick={() => setManyVisible(!allVisibleSelected)}
                    title={
                      allVisibleSelected
                        ? "Desmarca tudo que está à vista"
                        : foraDaMarcacao > 0
                          ? `Marca só os ${marcaveis.length} novos. ${foraDaMarcacao} ficam de fora; filtre por veredito para marcá-los.`
                          : "Marca tudo que está à vista"
                    }
                    className="shrink-0 h-9 px-3 rounded-xl border border-neutral-800 text-[10px] font-black uppercase tracking-widest text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors active:scale-[0.97]"
                  >
                    {allVisibleSelected
                      ? "Desmarcar à vista"
                      : foraDaMarcacao > 0
                        ? `Marcar ${marcaveis.length} novos`
                        : "Marcar à vista"}
                  </button>
                </div>

                {/* Cabeçalho ordenável. Numa pasta de milhares de itens, achar
                    "o maior arquivo" ou "todas as duplicatas juntas" sem ordenar
                    é rolagem no escuro. */}
                <div className="flex items-center gap-3 px-9 pb-2 shrink-0">
                  {(
                    [
                      ["nome", "Arquivo", "flex-1 text-left"],
                      ["tamanho", "Tamanho", "w-20 text-right"],
                      ["veredito", "Veredito", "w-24 text-right"],
                    ] as const
                  ).map(([campo, rotulo, cls]) => (
                    <button
                      key={campo}
                      type="button"
                      onClick={() =>
                        setOrdem((o) =>
                          o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: true },
                        )
                      }
                      aria-label={`Ordenar por ${rotulo.toLowerCase()}`}
                      className={`${cls} text-[9px] font-black uppercase tracking-widest transition-colors ${
                        ordem.campo === campo
                          ? "text-neutral-300"
                          : "text-neutral-700 hover:text-neutral-500"
                      }`}
                    >
                      {rotulo}
                      {ordem.campo === campo && (
                        <span aria-hidden className="ml-1">
                          {ordem.asc ? "↑" : "↓"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Lista */}
                <div ref={setScroller} className="flex-1 overflow-y-auto px-6 pb-4 no-scrollbar">
                  {visible.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-3 text-neutral-700">
                      <Search className="w-8 h-8 opacity-30" />
                      <p className="text-[11px] font-bold uppercase tracking-widest">
                        Nada neste recorte
                      </p>
                    </div>
                  ) : (
                    // Virtualizada: uma pasta de milhares de PSDs renderizava
                    // milhares de linhas com miniatura, e a rolagem travava.
                    // Agora só o que cabe na tela existe no DOM.
                    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                      {virtualizer.getVirtualItems().map((linha) => {
                        const it = visible[linha.index];
                        const m = VERDICT_META[it.verdict];
                        const on = selected.has(it.path);
                        const isImg = it.ext !== ".psd";
                        return (
                          <div
                            key={it.path}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: ALTURA_LINHA,
                              transform: `translateY(${linha.start}px)`,
                            }}
                            onClick={() => toggle(it.path)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggle(it.path);
                              }
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer text-left transition-[color,background-color,border-color] ${
                              on
                                ? "bg-white/[0.06] border-neutral-700"
                                : "bg-transparent border-transparent hover:bg-white/[0.03]"
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                                on ? "bg-white border-white" : "border-neutral-700"
                              }`}
                            >
                              {on && <CheckCircle2 className="w-3 h-3 text-black" />}
                            </span>

                            {isImg ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/local-image?path=${encodeURIComponent(it.path)}&w=64`}
                                alt=""
                                loading="lazy"
                                className="w-10 h-10 shrink-0 rounded-lg object-cover border border-neutral-800 bg-neutral-900"
                              />
                            ) : (
                              <div className="w-10 h-10 shrink-0 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                                <Layers className="w-4 h-4 text-neutral-700" />
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-[11px] font-bold truncate ${on ? "text-white" : "text-neutral-400"}`}
                              >
                                {it.name}
                                <span className="text-neutral-700 font-mono ml-1.5">{it.ext}</span>
                              </p>
                              <p className="text-[9px] text-neutral-700 font-mono truncate mt-0.5">
                                {it.path}
                              </p>
                            </div>

                            <span className="text-[9px] font-mono text-neutral-600 shrink-0 tabular-nums">
                              {it.width && it.height ? `${it.width}×${it.height}` : "—"}
                            </span>
                            <span className="text-[9px] font-mono text-neutral-600 shrink-0 w-16 text-right tabular-nums">
                              {fmtBytes(it.sizeBytes)}
                            </span>

                            <span
                              title={it.reason}
                              className={`shrink-0 text-[8px] font-black uppercase tracking-wider px-2 py-1 rounded-full border ${m.bg} ${m.text} max-w-[13rem] truncate`}
                            >
                              {it.reason || m.short}
                            </span>

                            {/* Ver o arquivo antes de decidir. Reusa /api/open-file,
                                que já existe. `stopPropagation` senão revelar no
                                Explorer também marcaria a linha. */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                revelar(it.path);
                              }}
                              title="Mostrar no Explorer"
                              aria-label={`Mostrar ${it.name} no Explorer`}
                              className="shrink-0 rounded-lg p-1.5 text-neutral-700 transition-colors hover:bg-white/5 hover:text-white"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Rodapé ── */}
        {phase === "review" && (
          <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950/80 backdrop-blur flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-600 uppercase tracking-widest min-w-0">
              <GlitchChars className="text-acc/40" intervalMs={400} />
              <span className="truncate">
                {selected.size} selecionados, {fmtBytes(selectedBytes)}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onClose}
                className="h-10 px-4 rounded-xl border border-neutral-800 text-[11px] font-black uppercase tracking-widest text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors active:scale-[0.97]"
              >
                Cancelar
              </button>
              {/* Um primário desabilitado é mentira: sem seleção, o que existe é
                  um texto dizendo o que fazer, não um botão morto. */}
              {selected.size === 0 ? (
                <span className="h-10 px-5 flex items-center text-[11px] font-black uppercase tracking-widest text-neutral-700">
                  Marque ao menos um item
                </span>
              ) : (
                <button
                  onClick={commit}
                  className="h-10 px-5 rounded-xl bg-white text-black text-[11px] font-black uppercase tracking-widest hover:bg-neutral-200 transition-colors active:scale-[0.97] shadow-xl shadow-white/5 flex items-center gap-2"
                >
                  <Import className="w-3.5 h-3.5" />
                  Ingerir {selected.size}
                </button>
              )}
            </div>
          </div>
        )}
      </motion.div>
      </DialogContent>
    </Dialog>
  );
}
