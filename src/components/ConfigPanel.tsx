"use client";

/**
 * Painel de configuração — acervo, conta, chaves e manutenção.
 *
 * Sem isto o app só é operável por quem tem terminal aberto: trocar uma chave
 * exigia editar `.env.local` e reiniciar o servidor. Para quem baixou o app,
 * isso não é atrito, é parede.
 *
 * ## Por que abas, e não uma coluna longa
 *
 * A versão anterior empilhava tudo numa rolagem só. Duas consequências medidas:
 * o rodapé de manutenção ("Duplicatas") competia com o conteúdo, e as chaves,
 * que são sete, empurravam o acervo para fora da primeira tela mesmo sendo o
 * acervo a única configuração que muda o que aparece no grid. Cada aba tem um
 * trabalho, e o padrão é o trabalho mais comum.
 *
 * ## O que este painel se recusa a fazer
 *
 * - **Não reexibe chave.** Só máscara. Reexibir para "conferir" põe o segredo no
 *   HTML e no cache do browser, e não ajuda: quem desconfia troca.
 * - **Não finge que gravou.** `process.env` vence a config, então uma chave
 *   travada no `.env.local` tornaria a edição inócua. O campo travado aparece
 *   desabilitado, com a origem escrita. O que não pode acontecer é a pessoa
 *   digitar, salvar e nada mudar, sem erro e sem aviso.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen, KeyRound, Server, Plus, Trash2, Check, Loader2, AlertTriangle,
  Database, HardDrive, ExternalLink, UserRound, LogOut, Copy, Wrench,
} from "lucide-react";
import { readError } from "@/lib/http-error";
import { Segmented } from "@/components/ui/Segmented";

type Origem = "env" | "config" | "ausente";

interface Provedor {
  chave: string;
  nome: string;
  liga: string;
  obter: string;
  definida: boolean;
  mascara: string | null;
  origem: Origem;
}

interface ConfigResposta {
  arquivo: string;
  catalogo: "mongo" | "local";
  itens: { total: number; visiveis: number; montado: boolean };
  acervo: { origem: Origem; pastas: { caminho: string; existe: boolean }[] };
  overlay: { origem: Origem; pastas: string[] };
  render: { porta: number; origem: Origem };
  provedores: Provedor[];
}

interface Usuario {
  id: string;
  email?: string;
  name?: string;
}

type Aba = "acervo" | "conta" | "chaves" | "avancado";
type EstadoTeste = { estado: "testando" | "ok" | "falhou"; motivo?: string };

/** O aviso de campo travado. Fica numa constante porque aparece em três lugares. */
const TRAVADO = "definido no .env.local, e o arquivo vence o painel";

function Bolinha({ ligado, titulo }: { ligado: boolean; titulo?: string }) {
  return (
    <span
      title={titulo}
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${ligado ? "bg-emerald-400" : "bg-neutral-700"}`}
    />
  );
}

function Cabecalho({
  icone: Icone,
  titulo,
  descricao,
}: {
  icone: typeof FolderOpen;
  titulo: string;
  descricao: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center shrink-0">
        <Icone className="w-4 h-4 text-neutral-300" />
      </div>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-white leading-tight">{titulo}</h4>
        <p className="text-[11px] text-neutral-400 mt-0.5">{descricao}</p>
      </div>
    </div>
  );
}

export function ConfigPanel({ onAbrirDuplicatas }: { onAbrirDuplicatas?: () => void }) {
  const [aba, setAba] = useState<Aba>("acervo");
  const [cfg, setCfg] = useState<ConfigResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [novaPasta, setNovaPasta] = useState("");
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [testes, setTestes] = useState<Record<string, EstadoTeste | undefined>>({});

  // Conta Visant (device flow: abre a aprovação no browser e fica de olho).
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [linkLogin, setLinkLogin] = useState<string | null>(null);
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

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

  const carregarUsuario = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/auth/me")).json()) as { user: Usuario | null };
      setUsuario(d.user);
    } catch {
      setUsuario(null);
    }
  }, []);

  useEffect(() => {
    void carregar();
    void carregarUsuario();
  }, [carregar, carregarUsuario]);

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

  /** Device flow da Visant, o mesmo que a home já usa para conectar marca. */
  const entrarVisant = useCallback(async () => {
    setEntrando(true);
    setErroLogin(null);
    setLinkLogin(null);
    try {
      const r = await fetch("/api/auth/visant", { method: "POST" });
      if (!r.ok) throw new Error(await readError(r, "Não consegui iniciar o login"));
      const d = (await r.json()) as { verificationUriComplete: string; expiresInSec?: number };
      setLinkLogin(d.verificationUriComplete);
      window.open(d.verificationUriComplete, "_blank", "noopener");

      const prazo = Date.now() + (d.expiresInSec ?? 600) * 1000;
      while (Date.now() < prazo) {
        await new Promise((res) => setTimeout(res, 5000));
        // Painel fechado no meio do login: a promessa continuaria viva e
        // gravaria estado num componente desmontado.
        if (!vivo.current) return;
        const p = (await (await fetch("/api/auth/visant/poll")).json()) as {
          status: string;
          message?: string;
        };
        if (p.status === "authorized") {
          await carregarUsuario();
          await carregar();
          setLinkLogin(null);
          return;
        }
        if (p.status === "error") throw new Error(p.message ?? "Login recusado");
      }
      throw new Error("O login expirou. Tente de novo.");
    } catch (e) {
      setErroLogin(e instanceof Error ? e.message : String(e));
      setLinkLogin(null);
    } finally {
      setEntrando(false);
    }
  }, [carregar, carregarUsuario]);

  const sairVisant = useCallback(async () => {
    await fetch("/api/auth/visant/logout", { method: "POST" }).catch(() => {});
    await carregarUsuario();
  }, [carregarUsuario]);

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
      <div className="p-6 flex flex-col gap-3">
        <div className="h-4 w-40 rounded bg-neutral-900 animate-pulse" />
        <div className="h-10 rounded-xl bg-neutral-900 animate-pulse" />
        <div className="h-10 rounded-xl bg-neutral-900 animate-pulse" />
      </div>
    );
  }

  const acervoTravado = cfg.acervo.origem === "env";
  const pastasFaltando = cfg.acervo.pastas.filter((p) => !p.existe).length;
  const chavesLigadas = cfg.provedores.filter((p) => p.definida).length;

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-5 pb-4 border-b border-neutral-900">
        <Segmented<Aba>
          value={aba}
          onChange={setAba}
          options={[
            { value: "acervo", label: "Acervo" },
            { value: "conta", label: "Conta" },
            { value: "chaves", label: `Chaves ${chavesLigadas}/${cfg.provedores.length}` },
            { value: "avancado", label: "Avançado" },
          ]}
        />
      </div>

      <div className="p-6 flex flex-col gap-6">
        {aba === "acervo" && (
          <>
            <Cabecalho
              icone={FolderOpen}
              titulo="Pastas do acervo"
              descricao="Onde os seus PSDs moram. É o que enche o grid."
            />

            <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-neutral-900/50 border border-neutral-800">
              {cfg.catalogo === "local" ? (
                <HardDrive className="w-4 h-4 text-neutral-400 shrink-0" />
              ) : (
                <Database className="w-4 h-4 text-neutral-400 shrink-0" />
              )}
              <p className="text-[11px] text-neutral-400 min-w-0">
                {cfg.itens.montado ? (
                  <>
                    <span className="text-white font-bold tabular-nums">{cfg.itens.visiveis}</span>{" "}
                    no grid, guardados{" "}
                  </>
                ) : (
                  /* Sem o índice montado NÃO existe número, e escrever "0"
                     seria mentira: o cache do catálogo é por worker, então uma
                     leitura fria devolve zero com o grid cheio. */
                  <>Catálogo montando, guardado{" "}</>
                )}
                {cfg.catalogo === "local" ? "nesta máquina" : "no MongoDB"}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {cfg.acervo.pastas.length === 0 && (
                <p className="text-[11px] text-neutral-500">
                  Nenhuma pasta ainda. Cole o caminho onde estão os seus PSDs e eles aparecem no
                  grid.
                </p>
              )}
              {cfg.acervo.pastas.map((p) => (
                <div
                  key={p.caminho}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900/50 border border-neutral-800"
                >
                  <span
                    title={p.existe ? "pasta encontrada" : "pasta não encontrada nesta máquina"}
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.existe ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                  <span className="text-[11px] font-mono text-neutral-300 truncate flex-1">
                    {p.caminho}
                  </span>
                  {!p.existe && (
                    <span className="text-[10px] font-bold text-amber-400 shrink-0">
                      não encontrada
                    </span>
                  )}
                  {!acervoTravado && (
                    <button
                      onClick={() =>
                        void salvar({
                          psdDirs: cfg.acervo.pastas
                            .filter((x) => x.caminho !== p.caminho)
                            .map((x) => x.caminho),
                        })
                      }
                      title="Remover do acervo"
                      aria-label={`Remover ${p.caminho}`}
                      className="p-1 rounded-lg text-neutral-500 hover:text-red-300 hover:bg-red-500/10 transition-ui press shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {pastasFaltando > 0 && (
                <p className="text-[10px] text-amber-400/90">
                  Pasta em amarelo não existe nesta máquina. Costuma ser a letra do drive, que muda
                  de computador para computador.
                </p>
              )}

              {acervoTravado ? (
                <p className="text-[10px] text-amber-400/90">{TRAVADO}</p>
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
                    aria-label="Caminho da pasta do acervo"
                    className="flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[11px] font-mono text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
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
            </div>
          </>
        )}

        {aba === "conta" && (
          <>
            <Cabecalho
              icone={UserRound}
              titulo="Visant Labs"
              descricao="Entrar traz as suas marcas para o app, com paleta e logo prontos."
            />

            {usuario ? (
              <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-neutral-900/50 border border-neutral-800">
                <Bolinha ligado titulo="conectado" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold text-white truncate">
                    {usuario.name ?? usuario.email ?? "conectado"}
                  </p>
                  {usuario.email && usuario.name && (
                    <p className="text-[10px] text-neutral-500 truncate">{usuario.email}</p>
                  )}
                </div>
                <button
                  onClick={() => void sairVisant()}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 text-[10px] font-bold text-neutral-300 hover:bg-neutral-700 hover:text-white transition-ui press flex items-center gap-1.5 shrink-0"
                >
                  <LogOut className="w-3 h-3" /> Sair
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => void entrarVisant()}
                  disabled={entrando}
                  className="px-4 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 disabled:opacity-60 transition-ui press flex items-center justify-center gap-2"
                >
                  {entrando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {entrando ? "Aguardando aprovação" : "Entrar com a Visant"}
                </button>
                <p className="text-[10px] text-neutral-500">
                  Abre uma aba para você aprovar. Volte aqui depois, que a conexão fecha sozinha.
                </p>
                {linkLogin && (
                  <a
                    href={linkLogin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-neutral-300 hover:text-white underline flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3 h-3" /> A aba não abriu? Clique aqui
                  </a>
                )}
                {erroLogin && <p className="text-[10px] text-red-300">{erroLogin}</p>}
              </div>
            )}

            <div className="border-t border-neutral-900 pt-4 flex flex-col gap-2">
              <p className="text-[10px] text-neutral-500">
                Prefere uma chave fixa, sem login? Use o campo Visant Labs na aba Chaves.
              </p>
              <a
                href="https://visantlabs.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-neutral-400 hover:text-white transition-colors flex items-center gap-1.5 w-fit"
              >
                <ExternalLink className="w-3 h-3" /> visantlabs.com
              </a>
            </div>
          </>
        )}

        {aba === "chaves" && (
          <>
            <Cabecalho
              icone={KeyRound}
              titulo="Suas chaves"
              descricao="Ficam nesta máquina. Cada uma liga uma parte do app, e nenhuma é obrigatória."
            />

            <div className="flex flex-col gap-2">
              {cfg.provedores.map((p) => {
                const travada = p.origem === "env";
                const teste = testes[p.chave];
                return (
                  <div
                    key={p.chave}
                    className="px-3.5 py-3 rounded-xl bg-neutral-900/50 border border-neutral-800 flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <Bolinha ligado={p.definida} />
                      <span className="text-[12px] font-bold text-white">{p.nome}</span>
                      <span className="text-[10px] text-neutral-400 truncate">liga {p.liga}</span>
                      {p.definida && (
                        <span className="ml-auto text-[10px] font-mono text-neutral-500 shrink-0">
                          {p.mascara}
                        </span>
                      )}
                    </div>

                    {travada ? (
                      <p className="text-[10px] text-amber-400/90">{TRAVADO}</p>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={rascunho[p.chave] ?? ""}
                          onChange={(e) =>
                            setRascunho((r) => ({ ...r, [p.chave]: e.target.value }))
                          }
                          placeholder={p.definida ? "substituir chave" : "colar chave"}
                          aria-label={`Chave da ${p.nome}`}
                          className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
                        />
                        <button
                          onClick={() => {
                            void salvar({ chaves: { [p.chave]: rascunho[p.chave] ?? "" } });
                            setRascunho((r) => ({ ...r, [p.chave]: "" }));
                            setTestes((t) => ({ ...t, [p.chave]: undefined }));
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
                            {teste?.estado === "testando" && (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            )}
                            {teste?.estado === "ok" && <Check className="w-3 h-3 text-emerald-400" />}
                            Testar
                          </button>
                        )}
                      </div>
                    )}

                    {!travada && !p.definida && (
                      <a
                        href={p.obter}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-neutral-500 hover:text-neutral-200 transition-colors flex items-center gap-1 w-fit"
                      >
                        <ExternalLink className="w-3 h-3" /> pegar chave da {p.nome}
                      </a>
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
            </div>
          </>
        )}

        {aba === "avancado" && (
          <>
            <Cabecalho
              icone={Server}
              titulo="Render-server"
              descricao="O processo que compõe a arte dentro do PSD. Sem ele dá para navegar, mas não dá para renderizar."
            />
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900/50 border border-neutral-800">
              <span className="text-[11px] text-neutral-400">porta</span>
              <span className="text-[11px] font-mono text-white tabular-nums">
                {cfg.render.porta}
              </span>
              {cfg.render.origem === "env" && (
                <span className="ml-auto text-[10px] text-amber-400/90">{TRAVADO}</span>
              )}
            </div>
            <p className="text-[10px] text-neutral-400">
              Suba com <span className="font-mono text-neutral-200">npm run render</span> noutra
              aba do terminal.
            </p>

            <div className="border-t border-neutral-900 pt-5 flex flex-col gap-3">
              <Cabecalho
                icone={Wrench}
                titulo="Manutenção"
                descricao="Ações que mexem no acervo. Nenhuma apaga arquivo do disco."
              />
              {onAbrirDuplicatas && (
                <button
                  onClick={onAbrirDuplicatas}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-neutral-900/50 border border-neutral-800 hover:border-neutral-600 transition-ui press text-left"
                >
                  <Copy className="w-4 h-4 text-neutral-300 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-white">Duplicatas</p>
                    <p className="text-[10px] text-neutral-400">
                      Encontrar PSDs repetidos e escolher quais esconder
                    </p>
                  </div>
                </button>
              )}
            </div>

            <div className="border-t border-neutral-900 pt-4">
              <p className="text-[10px] text-neutral-500 break-all">
                configuração gravada em{" "}
                <span className="font-mono text-neutral-400">{cfg.arquivo}</span>
              </p>
            </div>
          </>
        )}

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
    </div>
  );
}
