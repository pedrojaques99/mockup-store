"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Colunas derivadas da largura do CONTÊINER, não da janela.
 *
 * O `useMasonryColumns` do registry lê `window.innerWidth`, o que é certo numa
 * página comum e errado aqui: o grid vive entre dois painéis redimensionáveis e
 * colapsáveis, então a janela pode não mudar de tamanho nenhum enquanto a área
 * útil do grid dobra. Mesma conta do `repeat(auto-fill, minmax(min, 1fr))` que
 * este hook substitui — só que explícita, porque o masonry precisa do número.
 *
 * Devolve um **ref de callback**, não um `useRef`. A primeira versão usava
 * `useRef` + `useEffect`, e o grid nascia com UMA coluna: enquanto o skeleton
 * está na tela o `<div>` medido nem existe, o effect roda com `ref.current`
 * nulo e sai — e como a identidade do ref nunca muda, ele jamais roda de novo
 * quando o nó finalmente monta. Com callback ref o observer se liga ao nó no
 * instante em que ele aparece (e se desliga quando some).
 */
export function useContainerColumns(
  minWidth: number,
  gap: number,
): [(node: HTMLElement | null) => void, number] {
  const [cols, setCols] = useState(1);
  const roRef = useRef<ResizeObserver | null>(null);
  const el = useRef<HTMLElement | null>(null);
  // Geometria lida de dentro do observer para que mudar o tamanho do card não
  // recrie o callback — e com isso derrube e refaça o observer a cada tecla do
  // slider. Escrito em effect, nunca durante o render.
  const geom = useRef({ minWidth, gap });

  const measure = useCallback((w: number) => {
    if (w <= 0) return;
    const { minWidth: min, gap: g } = geom.current;
    // auto-fill: cabe mais uma coluna enquanto (n+1) itens + n gaps couberem.
    setCols(Math.max(1, Math.floor((w + g) / (min + g))));
  }, []);

  // Mudar o tamanho do card no slider não gera resize do contêiner — sem isto,
  // arrastar o slider não mudaria a contagem de colunas até um resize acontecer.
  useEffect(() => {
    geom.current = { minWidth, gap };
    if (el.current) measure(el.current.getBoundingClientRect().width);
  }, [minWidth, gap, measure]);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      el.current = node;
      if (!node) return;
      measure(node.getBoundingClientRect().width);
      const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
      ro.observe(node);
      roRef.current = ro;
    },
    [measure],
  );

  return [ref, cols];
}
