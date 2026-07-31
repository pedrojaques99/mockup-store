"use client";

/**
 * Switch — Radix (papel `switch`, `aria-checked`, teclado, foco), pele da casa.
 *
 * Havia duas versões escritas à mão, com tamanhos DIFERENTES (`w-7 h-4` na loja,
 * `w-7 h-3.5` no painel de render) e knobs diferentes (`w-3` vs `w-2.5`) — o mesmo
 * controle com duas medidas, e nenhum dos dois anunciando `role="switch"` para
 * leitor de tela.
 */
import * as RS from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** Nome acessível quando não há `<label>` associado. */
  label?: string;
  className?: string;
}) {
  return (
    <RS.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={cn(
        "relative w-7 h-4 shrink-0 rounded-full transition-colors [transition-duration:var(--dur-fast)]",
        "data-[state=checked]:bg-emerald-500/80 data-[state=unchecked]:bg-neutral-800",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
        className,
      )}
    >
      <RS.Thumb
        className={cn(
          "block w-3 h-3 rounded-full bg-white shadow transition-transform [transition-duration:var(--dur-fast)]",
          "translate-x-0.5 data-[state=checked]:translate-x-3.5",
        )}
      />
    </RS.Root>
  );
}
