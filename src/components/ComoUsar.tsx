"use client";

/**
 * Como usar — o tutorial de três passos que abre sozinho na primeira visita.
 *
 * O README ensina a SUBIR o app; ele não ensina a USAR. Quem abre a home pela
 * primeira vez vê uma parede de mockups e nenhum texto dizendo que o caminho
 * inteiro do produto são três cliques (escolher, soltar a arte, baixar). A
 * área de soltar a arte só existe DEPOIS de abrir um mockup, então o primeiro
 * passo não se descobre olhando: ou alguém conta, ou a pessoa acha que o grid
 * é só um catálogo para consultar.
 *
 * Abre uma vez e nunca mais (marca em `localStorage`); depois disso fica no
 * botão de interrogação do header, que é onde as pessoas procuram.
 */
import { useEffect, useState } from "react";
import { HelpCircle, MousePointerClick, ImageDown, Download, Camera } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/Dialog";

/** Versionada: subir o número reabre o tutorial para quem já tinha visto. */
const VISTO = "boxy.como-usar.v1";

const PASSOS = [
  {
    icon: MousePointerClick,
    titulo: "Escolha um mockup",
    texto: "Clique em qualquer imagem do grid. Abre um painel à direita com ele.",
  },
  {
    icon: ImageDown,
    titulo: "Solte sua arte",
    texto:
      "Arraste seu PNG na prévia do painel (ou clique nela para procurar no computador). O tamanho certo em pixels aparece escrito ali.",
  },
  {
    icon: Download,
    titulo: "Gere e baixe",
    texto: "Botão “Gerar PNG”, espera o render, “Baixar PNG”. Pronto.",
  },
];

export function ComoUsar() {
  const [aberto, setAberto] = useState(false);

  // Primeira visita abre sozinho. `useEffect` porque `localStorage` não existe
  // no servidor — ler no render daria hydration mismatch.
  useEffect(() => {
    try {
      if (!localStorage.getItem(VISTO)) setAberto(true);
    } catch {
      // Modo privado / storage bloqueado: sem tutorial automático, e tudo bem —
      // o botão do header continua lá.
    }
  }, []);

  const fechar = (v: boolean) => {
    setAberto(v);
    if (!v) {
      try {
        localStorage.setItem(VISTO, "1");
      } catch {}
    }
  };

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        title="Como usar"
        aria-label="Como usar"
        className="p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-ui press shrink-0"
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent
          title="Como usar"
          description="Os três passos para transformar sua arte em mockup."
          className="w-[min(460px,92vw)]"
        >
          <div className="p-6 flex flex-col gap-6">
            <div>
              <h2 className="text-base font-bold">Seu mockup em 3 cliques</h2>
              <p className="text-xs text-neutral-400 mt-1">
                Você traz a arte. O resto é aqui.
              </p>
            </div>

            <ol className="flex flex-col gap-4">
              {PASSOS.map((p, i) => (
                <li key={p.titulo} className="flex gap-3.5 items-start">
                  <div className="w-8 h-8 shrink-0 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-300">
                    <p.icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold leading-tight">
                      <span className="text-neutral-500 font-mono mr-1.5">{i + 1}</span>
                      {p.titulo}
                    </p>
                    <p className="text-xs text-neutral-400 leading-relaxed mt-1">{p.texto}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="border-t border-neutral-900 pt-4 flex items-center justify-between gap-3">
              <Link
                href="/photo-mockup"
                onClick={() => fechar(false)}
                className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-white transition-colors"
              >
                <Camera className="w-3.5 h-3.5 shrink-0" />
                Tem uma foto sua? Vire mockup no Scene Maker
              </Link>
              <DialogClose className="shrink-0 px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-ui press">
                Começar
              </DialogClose>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
