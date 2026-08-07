"use client";

/**
 * Atualizar — o aviso de versão nova e o botão que aplica.
 *
 * O ICP é designer. Para essa pessoa, `git pull && npm ci` não é uma
 * instrução: é um motivo para adiar. E app local que ninguém atualiza vira app
 * quebrado meses depois, com o usuário achando que o produto é ruim quando o
 * conserto já existia.
 *
 * Três decisões de interface, cada uma resolvendo um medo específico:
 *
 * 1. **Só aparece quando há novidade.** Um selo permanente de "atualizado" é
 *    ruído que a pessoa aprende a ignorar, e aí ela ignora também quando
 *    importa.
 * 2. **Mostra o que vem ANTES de aplicar.** A lista de mudanças transforma
 *    "sabe-se lá o que isso vai quebrar" em uma decisão informada.
 * 3. **Diz em voz alta o que NÃO é tocado.** O medo real não é a atualização
 *    falhar: é perder o acervo e as chaves configuradas. Como isso é o que trava
 *    o clique, a frase fica visível, não escondida numa ajuda.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, Check, Loader2, RefreshCw, AlertTriangle } from "lucide-react";

type Estado = {
  versionavel: boolean;
  atualCurto: string | null;
  branch: string | null;
  atras: number;
  temNovidade: boolean;
  sujo: boolean;
  novidades: string[];
  erro: string | null;
};

type Resultado = {
  ok: boolean;
  passos: { nome: string; ok: boolean; detalhe?: string }[];
  precisaReiniciar: boolean;
  erro: string | null;
};

export function Atualizar() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const checar = useCallback(async () => {
    try {
      const r = await fetch("/api/update", { cache: "no-store" });
      if (!r.ok) return; // 403 fora da própria máquina: some, não explica.
      setEstado(await r.json());
    } catch {
      // Sem rede o app continua funcionando. Aviso de update não é essencial.
    }
  }, []);

  useEffect(() => {
    checar();
  }, [checar]);

  const aplicar = async () => {
    setAplicando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/update", { method: "POST" });
      setResultado(await r.json());
      await checar();
    } catch {
      setResultado({
        ok: false, passos: [], precisaReiniciar: false,
        erro: "Não foi possível concluir. Tente de novo, ou use `npm run update` no terminal.",
      });
    } finally {
      setAplicando(false);
    }
  };

  // Nada a dizer: sem git, sem novidade, ou ainda checando.
  if (!estado?.versionavel || (!estado.temNovidade && !resultado)) return null;

  if (resultado?.ok && resultado.precisaReiniciar) {
    return (
      <aside className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
          <Check className="h-4 w-4" />
          Atualizado.
        </p>
        <p className="mt-1 text-sm text-neutral-400">
          Pare o app no terminal (Ctrl+C) e rode <code className="text-neutral-200">npm run dev</code>{" "}
          de novo para carregar a versão nova.
        </p>
      </aside>
    );
  }

  return (
    <aside className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ArrowDownToLine className="h-4 w-4 shrink-0 text-neutral-300" />
        <p className="text-sm font-medium text-neutral-100">
          {estado.atras === 1 ? "Tem 1 atualização" : `Tem ${estado.atras} atualizações`}
        </p>
        {estado.atualCurto && (
          <span className="text-xs tabular-nums text-neutral-500">
            você está em {estado.atualCurto}
          </span>
        )}
      </div>

      {estado.novidades.length > 0 && (
        <ul className="mt-3 space-y-1 border-l border-neutral-700 pl-3">
          {estado.novidades.map((n, i) => (
            <li key={i} className="text-sm text-neutral-400">
              {n}
            </li>
          ))}
        </ul>
      )}

      {estado.sujo ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Você tem alteração no código que ainda não foi salva no git. A atualização não roda
          para não sobrescrever isso.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={aplicar}
              disabled={aplicando}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
            >
              {aplicando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {aplicando ? "Atualizando…" : "Atualizar agora"}
            </button>
            <p className="text-xs text-neutral-500">
              Seus PSD, suas chaves e suas configurações ficam como estão.
            </p>
          </div>
          {aplicando && (
            <p className="mt-2 text-xs text-neutral-500">
              Se houver dependência nova, isso pode levar alguns minutos. Não feche a aba.
            </p>
          )}
        </>
      )}

      {resultado?.erro && (
        <p className="mt-3 text-sm text-red-400">{resultado.erro}</p>
      )}
    </aside>
  );
}
