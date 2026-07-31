"use client";

import { cn } from "@/lib/utils";

/**
 * Alvo de soltar — o retorno visual de que a página inteira aceita o arquivo.
 *
 * Colhido de `visantlabs-os/src/components/ui/DropOverlay.tsx` (canônico no
 * registry como `@visant/drop-overlay`).
 *
 * Por que ele importa aqui: soltar a arte só funcionava dentro de um retângulo
 * do painel direito, e só quando o mockup tinha faces editáveis. Arrastar um PNG
 * sobre o grid não fazia nada — o navegador abria o arquivo e o trabalho do
 * usuário sumia. Um alvo que cobre a janela transforma "adivinhe onde soltar" em
 * "solte em qualquer lugar".
 *
 * `pointer-events-none` é essencial: o overlay não pode roubar o `dragleave` do
 * container que conta os eventos de arrasto, senão ele pisca sem parar.
 */
export function DropOverlay({
  visible,
  message = "Solte a arte aqui",
  hint,
  className,
}: {
  visible: boolean;
  message?: string;
  /** Segunda linha — o que vai acontecer depois de soltar. */
  hint?: string;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <div
      className={cn(
        "fixed inset-0 z-[130] flex flex-col items-center justify-center gap-2",
        "bg-neutral-950/70 backdrop-blur-sm border-2 border-dashed border-acc/40",
        "pointer-events-none animate-in fade-in duration-150",
        className,
      )}
    >
      <span className="text-sm text-neutral-200 font-mono uppercase tracking-widest">
        {message}
      </span>
      {hint && (
        <span className="text-[11px] text-neutral-500 font-mono uppercase tracking-widest">
          {hint}
        </span>
      )}
    </div>
  );
}
