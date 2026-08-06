/**
 * Skeleton — o primitivo que faltava.
 *
 * Todo estado de carregando deste app era spinner ou nada, por falta de peça: o
 * catálogo de slop chama isso pelo nome (#3, "spinner no lugar do skeleton"), e o
 * sintoma é o bloco colapsar enquanto carrega e saltar quando o dado chega.
 * Estrutura estática pinta, só o dado borra.
 *
 * Fonte: item oficial `skeleton` do registry shadcn/ui
 * (https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json), transcrito sem
 * mudança de comportamento. NÃO foi instalado pelo CLI de propósito: este repo não
 * tem `components.json`, e `shadcn init` reescreve `globals.css` — onde moram o
 * bloco `@theme` da marca BOXY e as utilities `transition-ui`, `press` e
 * `no-scrollbar`. O ganho de um `add` não paga o risco de perder isso.
 *
 * Única adaptação: `bg-accent` do tema padrão do shadcn não existe aqui (a marca
 * é mono-verde e `accent` seria o verde de AÇÃO — um esqueleto verde-limão diria
 * "clique em mim"). Fica no cinza de superfície, que é o que o resto do app usa
 * para "isto ainda não é conteúdo".
 *
 * `animate-pulse` respeita `prefers-reduced-motion` pela regra global do
 * `globals.css`.
 */
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-neutral-800/60", className)}
      {...props}
    />
  );
}

export { Skeleton };
