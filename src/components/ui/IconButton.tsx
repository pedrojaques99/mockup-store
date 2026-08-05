"use client";

/**
 * IconButton — botão icon-first com tooltip OBRIGATÓRIO (= sempre comunicativo).
 * Fonte única de toda ação/seleção por ícone nos painéis do editor, pra garantir
 * consistência visual (mesmos tamanhos, estados e variantes em todo lugar).
 *
 * `label` vira tooltip + aria-label. Use `selected` pra estado ativo de um grupo
 * (segmented), `variant` pra cor da ação. Deve viver dentro de um <TooltipProvider>
 * (o ToolRail já embrulha os painéis num).
 */
import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

export type IconButtonVariant = "ghost" | "primary" | "accent" | "danger" | "violet";

const BASE = "rounded-lg border transition-ui [transition-duration:var(--dur-fast)] active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none disabled:active:scale-100";

const VARIANT: Record<IconButtonVariant, string> = {
  ghost:   "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60 hover:text-zinc-200",
  primary: "bg-zinc-100 text-zinc-950 border-zinc-100 hover:bg-white",
  accent:  "bg-acc2 text-zinc-950 border-acc2 hover:bg-acc2/90",
  danger:  "bg-rose-500 text-white border-rose-500 hover:bg-rose-500/90",
  violet:  "bg-violet-500 text-white border-violet-500 hover:bg-violet-500/90",
};

// Quando `selected`, a variante pinta o estado ativo (segmented controls).
const SELECTED: Record<IconButtonVariant, string> = {
  ghost:   "bg-zinc-100 text-zinc-950 border-zinc-100",
  primary: "bg-zinc-100 text-zinc-950 border-zinc-100",
  accent:  "bg-acc2 text-zinc-950 border-acc2",
  danger:  "bg-rose-500 text-white border-rose-500",
  violet:  "bg-violet-500 text-white border-violet-500",
};

export interface IconButtonProps {
  icon: LucideIcon;
  /** Tooltip + aria-label (obrigatório → o ícone nunca fica mudo). */
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: IconButtonVariant;
  /** Estado ativo num grupo (segmented). */
  selected?: boolean;
  disabled?: boolean;
  /** Texto opcional ao lado do ícone (use com parcimônia — o padrão é só ícone). */
  text?: string;
  iconSize?: number;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, onClick, variant = "ghost", selected = false, disabled, text, iconSize = 14, tooltipSide = "top", className },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={selected || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        BASE,
        // Altura = pill (py-1.5) → alinha com Segmented/IconSegmented e pills manuais.
        text ? "flex items-center justify-center py-1.5 px-2.5 gap-1.5 text-[10px] font-medium" : "grid place-items-center w-8 py-1.5",
        selected ? SELECTED[variant] : VARIANT[variant],
        className,
      )}
    >
      <Icon size={iconSize} />
      {text && <span>{text}</span>}
    </button>
  );
  // Sem tooltip quando há texto visível (já comunica) — evita ruído redundante.
  return text ? btn : <Tooltip label={label} side={tooltipSide}>{btn}</Tooltip>;
});
