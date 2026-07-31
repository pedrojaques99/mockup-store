"use client";

/**
 * Select — Radix behaviour (teclado, tipo-para-buscar, colisão, a11y, portal),
 * pele da casa.
 *
 * Existe porque o `<select>` nativo **não é estilizável na lista**: o gatilho até
 * aceita CSS, mas o popup de opções é desenhado pelo sistema operacional — fundo
 * branco e realce azul do Windows dentro de uma UI escura. Não é questão de gosto:
 * é a única parte do app que o CSS não alcança.
 *
 * Radix é o mesmo primitivo que já sustenta o Popover e o Tooltip aqui — nada de
 * lista suspensa escrita à mão, que é onde some o teclado e a a11y.
 */
import * as RS from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Contagem à direita (facetas). */
  hint?: string | number;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  className,
  align = "start",
  skin = "neutral",
  boxed = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  align?: "start" | "center" | "end";
  /** `neutral` = loja · `zinc` = editor. São cinzas diferentes de propósito. */
  skin?: "neutral" | "zinc";
  /** Gatilho com moldura (dentro de painel) em vez de linha nua (sidebar). */
  boxed?: boolean;
}) {
  const T = skin === "zinc"
    ? { text: "text-zinc-200", muted: "text-zinc-500", chev: "text-zinc-500", hoverChev: "group-hover/sel:text-zinc-300",
        box: "bg-zinc-800/60 border border-zinc-700/50 hover:bg-zinc-700/60",
        menu: "border-zinc-700/60 bg-zinc-900/95", item: "text-zinc-400 data-[highlighted]:bg-white/8 data-[highlighted]:text-white", hint: "text-zinc-600" }
    : { text: "text-white", muted: "text-neutral-500", chev: "text-neutral-600", hoverChev: "group-hover/sel:text-neutral-400",
        box: "bg-neutral-900 border border-neutral-800 hover:border-neutral-700",
        menu: "border-neutral-800 bg-neutral-950/95", item: "text-neutral-400 data-[highlighted]:bg-white/8 data-[highlighted]:text-white", hint: "text-neutral-600" };
  return (
    <RS.Root value={value} onValueChange={onChange}>
      <RS.Trigger
        aria-label={ariaLabel}
        className={cn(
          "group/sel flex w-full items-center gap-2 outline-none rounded-lg",
          "focus-visible:ring-1 focus-visible:ring-white/20",
          boxed ? cn("px-2 py-1.5 text-[11px] font-medium", T.box) : "px-1 h-9 text-sm font-bold",
          value ? T.text : T.muted,
          className,
        )}
      >
        <span className="truncate text-left">
          <RS.Value placeholder={placeholder} />
        </span>
        <RS.Icon asChild>
          <ChevronDown className={cn("ml-auto w-3.5 h-3.5 shrink-0 transition-colors", T.chev, T.hoverChev)} />
        </RS.Icon>
      </RS.Trigger>

      <RS.Portal>
        <RS.Content
          position="popper"
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            "z-[80] min-w-[var(--radix-select-trigger-width)] max-h-[min(24rem,var(--radix-select-content-available-height))]",
            "overflow-hidden rounded-xl border backdrop-blur-md shadow-2xl", T.menu,
          )}
        >
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg pl-7 pr-3 py-1.5 text-xs font-bold outline-none cursor-pointer select-none",
                  T.item, "data-[state=checked]:text-white",
                )}
              >
                <RS.ItemIndicator className="absolute left-2 flex items-center">
                  <Check className="w-3 h-3" />
                </RS.ItemIndicator>
                <RS.ItemText>{o.label}</RS.ItemText>
                {o.hint != null && (
                  <span className={cn("ml-auto pl-3 text-[10px] font-medium tabular-nums", T.hint)}>{o.hint}</span>
                )}
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
