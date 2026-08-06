"use client";

/**
 * IconSegmented — seletor single-select icon-first (cada opção = ícone + tooltip).
 * Padroniza os "escolha a ferramenta/modo" dos painéis. Renderiza PILLS `py-1.5`
 * idênticas às pills manuais (alvos da máscara, abas da Luz) → mesma altura em todo
 * lugar. Comunicativo via tooltip.
 */
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import type { IconButtonVariant } from "@/components/ui/IconButton";

const IDLE = "bg-neutral-800/60 text-neutral-400 border-neutral-700/50 hover:bg-neutral-700/60 hover:text-neutral-200";
const SELECTED: Record<IconButtonVariant, string> = {
  ghost:   "bg-neutral-100 text-neutral-950 border-neutral-100",
  primary: "bg-neutral-100 text-neutral-950 border-neutral-100",
  accent:  "bg-acc2 text-neutral-950 border-acc2",
  danger:  "bg-rose-500 text-white border-rose-500",
  violet:  "bg-violet-500 text-white border-violet-500",
};

export interface IconSegOption<T extends string> {
  value: T;
  /** Tooltip + aria-label. */
  label: string;
  icon: LucideIcon;
  /** Variante do estado ativo desta opção (default herda do grupo). */
  variant?: IconButtonVariant;
}

export function IconSegmented<T extends string>({
  value,
  onChange,
  options,
  variant = "ghost",
  columns,
  iconSize = 14,
}: {
  value: T;
  onChange: (v: T) => void;
  options: IconSegOption<T>[];
  /** Variante do ativo (uma cor pro grupo todo). */
  variant?: IconButtonVariant;
  /** Colunas do grid (default = nº de opções). */
  columns?: number;
  iconSize?: number;
}) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0,1fr))` }}>
      {options.map((o) => {
        const on = value === o.value;
        const Icon = o.icon;
        return (
          <Tooltip key={o.value} label={o.label} side="top">
            <button
              type="button"
              aria-label={o.label}
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex items-center justify-center py-1.5 rounded-lg border text-[10px] font-medium transition-ui press",
                on ? SELECTED[o.variant ?? variant] : IDLE,
              )}
            >
              <Icon size={iconSize} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
