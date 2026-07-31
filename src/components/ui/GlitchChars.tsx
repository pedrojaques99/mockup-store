"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Dois caracteres que trocam sozinhos — o "sinal de vida" mais barato que existe.
 *
 * Colhido do registry `@visant/glitch-chars` (Z:\Cursor\Vintageuiuxlibrary).
 * Copiado em vez de instalado porque este repo não tem shadcn inicializado e o
 * componente só depende de `cn` — a decisão de "não retrofitar app que já
 * funciona" está registrada no próprio VISANT-REGISTRY-PLANO.md. Comportamento
 * verbatim; só a paleta é a daqui.
 *
 * Um spinner diz "esperando"; isto diz "a máquina está mexendo", que é outra
 * sensação. 150ms é deliberado: acima de ~200ms lê como piscada quebrada,
 * abaixo de ~100ms vira ruído que cansa.
 *
 * `prefers-reduced-motion`: congela num par fixo — o layout não pula porque a
 * largura é sempre a mesma em fonte mono.
 */
export function GlitchChars({
  chars = "*•□./-®",
  length = 2,
  intervalMs = 150,
  className,
  style,
}: {
  /** Pool de caracteres sorteados. Troque para mudar o "sotaque" do ruído. */
  chars?: string;
  /** Quantos caracteres por quadro. Fonte mono ⇒ largura estável. */
  length?: number;
  /** Milissegundos entre quadros. */
  intervalMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [text, setText] = useState(() => chars.slice(0, length));

  useEffect(() => {
    const media =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    if (media?.matches) return;

    const id = setInterval(() => {
      setText(
        Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join(""),
      );
    }, intervalMs);
    return () => clearInterval(id);
  }, [chars, length, intervalMs]);

  return (
    <span
      aria-hidden="true"
      className={cn("inline-block select-none font-mono tabular-nums", className)}
      style={style}
    >
      {text}
    </span>
  );
}
