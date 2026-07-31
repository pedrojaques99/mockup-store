"use client";

/**
 * MasonryGallery — item `@visant/masonry-gallery` do registry da casa.
 * Fonte da verdade: `Z:\Cursor\Vintageuiuxlibrary/registry/visant/ui/masonry-gallery.tsx`
 * (publicado em visant-ui.vercel.app/r/masonry-gallery.json). Copiado verbatim —
 * qualquer correção sobe no registry primeiro e desce daqui, nunca ao contrário.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

export interface MasonryBreakpoints {
  /** < 640px */ base: number;
  /** < 1024px */ sm: number;
  /** < 1280px */ lg: number;
  /** ≥ 1280px */ xl: number;
}

const DEFAULT_BREAKPOINTS: MasonryBreakpoints = { base: 2, sm: 3, lg: 4, xl: 5 };

/**
 * Contagem de colunas responsiva. Exportada porque o call site às vezes precisa
 * saber quantas colunas existem (ex.: pedir a próxima página em múltiplos dela).
 */
export function useMasonryColumns(
  bp: MasonryBreakpoints = DEFAULT_BREAKPOINTS,
): number {
  const read = React.useCallback(() => {
    if (typeof window === "undefined") return bp.lg;
    const w = window.innerWidth;
    if (w < 640) return bp.base;
    if (w < 1024) return bp.sm;
    if (w < 1280) return bp.lg;
    return bp.xl;
  }, [bp.base, bp.sm, bp.lg, bp.xl]);

  const [cols, setCols] = React.useState(read);

  React.useEffect(() => {
    const onResize = () => setCols(read());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [read]);

  return cols;
}

/**
 * Masonry por round-robin (`i % cols`) — colunas de flex, não CSS `columns`.
 *
 * A escolha do round-robin é a coisa que importa aqui, e ela é contra-intuitiva:
 * a distribuição "certa" (sempre na coluna mais curta) exige medir as alturas, e
 * medir significa que ANEXAR uma página reordena o que já estava na tela. Num
 * feed infinito isso é o pior bug possível — o usuário perde o item que estava
 * olhando. Round-robin por índice é levemente menos equilibrado e perfeitamente
 * estável: item que entrou numa coluna nunca sai dela.
 *
 * Também é o motivo de não usar CSS `columns`: lá o navegador reflui a ordem
 * inteira e a leitura vira vertical-serpenteante, que quebra ordem cronológica.
 *
 * Não sabe o que renderiza: `renderItem` decide. Serve thumbnail, card, vídeo,
 * nó vivo — aspect ratios misturados são o caso normal, não a exceção.
 */
export function MasonryGallery<T>({
  items,
  renderItem,
  getKey,
  cols,
  breakpoints,
  gap = 12,
  className,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => React.Key;
  /** Colunas fixas. Omita para responsivo. */
  cols?: number;
  breakpoints?: MasonryBreakpoints;
  /** Espaço entre itens e colunas, em px. */
  gap?: number;
  className?: string;
}) {
  const responsive = useMasonryColumns(breakpoints);
  const n = Math.max(1, cols ?? responsive);

  const columns = React.useMemo(() => {
    const out: Array<Array<{ item: T; idx: number }>> = Array.from(
      { length: n },
      () => [],
    );
    items.forEach((item, idx) => out[idx % n].push({ item, idx }));
    return out;
  }, [items, n]);

  return (
    <div
      className={cn("flex items-start", className)}
      style={{ gap }}
      role="list"
    >
      {columns.map((col, ci) => (
        <div
          key={ci}
          className="flex min-w-0 flex-1 flex-col"
          style={{ gap }}
        >
          {col.map(({ item, idx }) => (
            <div role="listitem" key={getKey(item, idx)}>
              {renderItem(item, idx)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
