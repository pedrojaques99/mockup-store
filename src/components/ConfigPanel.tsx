"use client";

/**
 * Painel de configuração — pastas do acervo, chaves BYOK e render-server, na
 * tela em vez de no `.env.local`.
 *
 * Sem isto o app só é operável por quem tem terminal aberto e sabe o que é um
 * arquivo de ambiente: trocar uma chave exigia editar `.env.local` e reiniciar
 * o servidor. Para quem baixou o app, isso não é fricção — é uma parede.
 *
 * ## O que este painel se recusa a fazer
 *
 * - **Não reexibe chave.** Só máscara. Reexibir para "conferir" põe o segredo
 *   no HTML e no cache do browser, e não ajuda ninguém: quem desconfia troca.
 * - **Não finge que gravou.** `process.env` vence a config, então uma chave
 *   travada no `.env.local` tornaria a edição inócua. O campo travado aparece
 *   desabilitado, com a origem escrita. O que não pode acontecer é a pessoa
 *   digitar, salvar e nada mudar — sem erro, sem aviso.
 */
import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen, KeyRound, Server, Plus, Trash2, Check, Loader2,
  AlertTriangle, Database, HardDrive,
} from "lucide-react";
import { readError } from "@/lib/http-error";

type Origem = "env" | "config" | "ausente";

interface Provedor {
  chave: string;
  nome: string;
  liga: string;
  definida: boolean;
  mascara: string | null;
  origem: Origem;
}

interface ConfigResposta {
  arquivo: string;
  catalogo: "mongo" | "local";
  acervo: { origem: Origem; pastas: { caminho: string; existe: boolean }[] };
  overlay: { origem: Origem; pastas: string[] };
  render: { porta: number; origem: Origem };
  provedores: Provedor[];
}

type EstadoTeste = { estado: "testando" | "ok" | "falhou"; motivo?: string };

const ORIGEM_TEXTO: Record<Origem, string> = {
  env: "definido no .env.local — o arquivo vence o painel",
  config: "salvo aqui",
  ausente: "",
};

function Secao({
  icone: Icone,
  titulo,
  descricao,
  children,
}: {
  icone: typeof FolderOpen;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center shrink-0">
          <Icone className="w-4 h-4 text-neutral-300" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white leading-tight">{titulo}</h4>
          <p className="text-[11px] text-neutral-500 mt-0.5">{descricao}</p>
        </div>
      </div>
      <div className="pl-11 flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function ConfigPanel() {
  const [cfg, setCfg] = useState<ConfigResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [novaPasta, setNovaPasta] = useState("");
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [testes, setTestes] = useState<Record<string, EstadoTeste>>({});

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/config");
      if (!r.ok) throw new Error(await readError(r, "Não consegui ler a configuração"));
      setCfg((await r.json()) as ConfigResposta);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const salvar = useCallback(
    async (corpo: Record<string, unknown>) => {
      setSalvando(true);
      setErro(null);
      try {
        const r = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        if (!r.ok) throw new Error(await readError(r, "Não consegui gravar"));
        await carregar();
        setSalvo(true);
        setTimeout(() => setSalvo(false), 2000);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setSalvando(false);
      }
    },
    [carregar],
  );

  const testar = useCallback(async (chave: string) => {
    setTestes((t) => ({ ...t, [chave]: { estado: "testando" } }));
    try {
      const r = await fetch("/api/config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave }),
      });
      const d = (await r.json()) as { ok?: boolean; motivo?: string };
      setTestes((t) => ({
        ...t,
        [chave]: d.ok ? { estado: "ok" } : { estado: "falhou", motivo: d.motivo },
      }));
    } catch (e) {
      setTestes((t) => ({
        ...t,
        [chave]: { estado: "falhou", motivo: e instanceof Error ? e.message : String(e) },
      }));
    }
  }, []);

  if (erro && !cfg) {
    return (
      <div className="p-6 text-xs text-red-300 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{erro}</span>
      </div>
    );
  }
  if (!cfg) {
    return (
      <div className="p-6 flex items-center gap-2 text-xs text-neutral-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Lendo configuração…
      </div>
    );
  }

  const acervoTravado = cfg.acervo.origem === "env";

  return (
    <div className="flex flex-col gap-7 p-6">
      {/* Onde o catálogo mora. É o primeiro fato que explica todo o resto. */}
      <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-neutral-900/50 border border-neutral-800">
        {cfg.catalogo === "local" ? (
          <HardDrive className="w-4 h-4 text-neutral-400 shrink-0" />
        ) : (
          <Database className="w-4 h-4 text-neutral-400 shrink-0" />
        )}
        <p className="text-[11px] text-neutral-400 min-w-0">
          Catálogo{" "}
          <span className="text-white font-bold">
            {cfg.catalogo === "local" ? "local (nesta máquina)" : "no MongoDB"}
          </span>
          <span className="text-neutral-600"> · configuração em {cfg.arquivo}</span>
        </p>
      </div>

      <Secao
        icone={FolderOpen}
        titulo="Pastas do acervo"
        descricao="Onde os seus PSDs moram. É o que enche o grid."
      >
        {cfg.acervo.pastas.length === 0 && (
          <p className="text-[11px] text-neutral-600 italic">
            Nenhuma pasta ainda — o grid mostra só as cenas de foto.
          </p>
        )}
        {cfg.acervo.pastas.map((p) => (
          <div
            key={p.caminho}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900/50 border border-neutral-800"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.existe ? "bg-emerald-400" : "bg-amber-400"}`}
              title={p.existe ? "pasta encontrada" : "pasta não encontrada nesta máquina"}
            />
            <span className="text-[11px] font-mono text-neutral-300 truncate flex-1">{p.caminho}</span>
            {!p.existe && (
              <span className="text-[10px] font-bold text-amber-400 shrink-0">não encontrada</span>
            )}
            {!acervoTravado && (
              <button
                onClick={() =>
                  void salvar({
                    psdDirs: cfg.acervo.pastas.filter((x) => x.caminho !== p.caminho).map((x) => x.caminho),
                  })
                }
                title="Remover do acervo"
                aria-label={`Remover ${p.caminho}`}
                className="p-1 rounded-lg text-neutral-600 hover:text-red-300 hover:bg-red-500/10 transition-ui press shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}

        {acervoTravado ? (
          <p className="text-[10px] text-amber-400/80">{ORIGEM_TEXTO.env}</p>
        ) : (
          <div className="flex gap-2">
            <input
              value={novaPasta}
              onChange={(e) => setNovaPasta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && novaPasta.trim()) {
                  void salvar({
                    psdDirs: [...cfg.acervo.pastas.map((x) => x.caminho), novaPasta.trim()],
                  });
                  setNovaPasta("");
                }
              }}
              placeholder="Z:/BOXY/Produtos"
              className="flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[11px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
            />
            <button
              onClick={() => {
                if (!novaPasta.trim()) return;
                void salvar({
                  psdDirs: [...cfg.acervo.pastas.map((x) => x.caminho), novaPasta.trim()],
                });
                setNovaPasta("");
              }}
              disabled={!novaPasta.trim() || salvando}
              className="px-3 py-2 rounded-xl bg-neutral-800 text-[11px] font-bold text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 transition-ui press flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar
            </button>
          </div>
        )}
      </Secao>

      <Secao
        icone={KeyRound}
        titulo="Suas chaves"
        descricao="Ficam nesta máquina. Cada uma liga uma parte do app — nenhuma é obrigatória."
      >
        {cfg.provedores.map((p) => {
          const travada = p.origem === "env";
          const teste = testes[p.chave];
          return (
            <div
              key={p.chave}
              className="px-3.5 py-3 rounded-xl bg-neutral-900/50 border border-neutral-800 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.definida ? "bg-emerald-400" : "bg-neutral-700"}`}
                />
                <span className="text-[12px] font-bold text-white">{p.nome}</span>
                <span className="text-[10px] text-neutral-500 truncate">liga {p.liga}</span>
                {p.definida && (
                  <span className="ml-auto text-[10px] font-mono text-neutral-600 shrink-0">
                    {p.mascara}
                  </span>
                )}
              </div>

              {travada ? (
                <p className="text-[10px] text-amber-400/80">{ORIGEM_TEXTO.env}</p>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={rascunho[p.chave] ?? ""}
                    onChange={(e) => setRascunho((r) => ({ ...r, [p.chave]: e.target.value }))}
                    placeholder={p.definida ? "substituir chave…" : "colar chave…"}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
                  />
                  <button
                    onClick={() => {
                      void salvar({ chaves: { [p.chave]: rascunho[p.chave] ?? "" } });
                      setRascunho((r) => ({ ...r, [p.chave]: "" }));
                      setTestes((t) => ({ ...t, [p.chave]: undefined as never }));
                    }}
                    disabled={!(rascunho[p.chave] ?? "").trim() || salvando}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800 text-[10px] font-bold text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 transition-ui press shrink-0"
                  >
                    Salvar
                  </button>
                  {p.definida && (
                    <button
                      onClick={() => void testar(p.chave)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 text-[10px] font-bold text-neutral-300 hover:bg-neutral-700 hover:text-white transition-ui press shrink-0 flex items-center gap-1.5"
                    >
                      {teste?.estado === "testando" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : teste?.estado === "ok" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : null}
                      Testar
                    </button>
                  )}
                </div>
              )}

              {teste?.estado === "ok" && (
                <p className="text-[10px] text-emerald-400">Chave aceita pelo provedor.</p>
              )}
              {teste?.estado === "falhou" && (
                <p className="text-[10px] text-red-300">{teste.motivo}</p>
              )}
            </div>
          );
        })}
      </Secao>

      <Secao
        icone={Server}
        titulo="Render-server"
        descricao="O processo que compõe a arte dentro do PSD. Sem ele, navegar funciona; renderizar não."
      >
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900/50 border border-neutral-800">
          <span className="text-[11px] text-neutral-400">porta</span>
          <span className="text-[11px] font-mono text-white">{cfg.render.porta}</span>
          {cfg.render.origem === "env" && (
            <span className="ml-auto text-[10px] text-amber-400/80">{ORIGEM_TEXTO.env}</span>
          )}
        </div>
        <p className="text-[10px] text-neutral-600">
          Suba com <span className="font-mono text-neutral-400">npm run render</span>.
        </p>
      </Secao>

      {erro && (
        <p className="text-[11px] text-red-300 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {erro}
        </p>
      )}
      {salvo && (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> Salvo.
        </p>
      )}
    </div>
  );
}
