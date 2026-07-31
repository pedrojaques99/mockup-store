"use client";

/**
 * ToolRail — floating, icon-only vertical rail (left edge) + um painel flutuante
 * ARRASTÁVEL e STICKY para a tool ativa. Data-driven de um RailTool[].
 *
 * Seleção: clicar uma tool inativa seleciona + abre o painel; clicar a ativa
 * alterna o painel. O painel **só fecha** pelo X, por ESC, ou alternando a tool —
 * NUNCA por clique fora (assim dá pra mexer no canvas com o painel aberto).
 * O painel é arrastável pela barra de título (handle `.panel-drag`).
 */
import { Fragment, useEffect, useRef } from "react";
import Draggable from "react-draggable";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipProvider } from "@/components/ui/Tooltip";

export interface RailTool<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** Consecutive tools sharing a group render together; a divider separates groups. */
  group?: string;
  /** Atalho de teclado (mostrado no tooltip). */
  shortcut?: string;
}

export function ToolRail<T extends string>({
  tools,
  active,
  panelOpen,
  onSelect,
  onPanelOpenChange,
  children,
}: {
  tools: RailTool<T>[];
  active: T;
  panelOpen: boolean;
  onSelect: (id: T) => void;
  onPanelOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  const groups: RailTool<T>[][] = [];
  let lastGroup: string | undefined;
  tools.forEach((t, i) => {
    if (i === 0 || t.group !== lastGroup) groups.push([]);
    groups[groups.length - 1].push(t);
    lastGroup = t.group;
  });

  // ESC fecha o painel (único atalho de fechar além do X / toggle da tool).
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onPanelOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, onPanelOpenChange]);

  const activeLabel = tools.find((t) => t.id === active)?.label ?? "";

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100}>
      {/* Rail */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1 rounded-2xl border border-zinc-700/60 bg-zinc-900/90 backdrop-blur-md p-1.5 shadow-2xl">
        {groups.map((grp, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <div className="mx-2 my-1 h-px bg-zinc-700/50" />}
            {grp.map((t) => {
              const isActive = t.id === active;
              const Icon = t.icon;
              return (
                <Tooltip key={t.id} label={t.shortcut ? `${t.label} · ${t.shortcut}` : t.label}>
                  <button
                    type="button"
                    aria-label={t.label}
                    aria-pressed={isActive}
                    onClick={() => {
                      if (isActive) onPanelOpenChange(!panelOpen);
                      else { onSelect(t.id); onPanelOpenChange(true); }
                    }}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 w-12 h-12 rounded-xl transition-[color,background-color,border-color,box-shadow,opacity,transform] [transition-duration:var(--dur-fast)] active:scale-90",
                      isActive ? "bg-acc2 text-zinc-950 shadow-md shadow-acc2/20" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    )}
                  >
                    <Icon size={17} strokeWidth={2} />
                    <span className={cn("text-[7.5px] font-medium leading-none tracking-tight", isActive ? "text-zinc-900" : "text-zinc-500")}>
                      {t.label}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Painel flutuante arrastável + sticky */}
      {panelOpen && (
        <Draggable nodeRef={panelRef as any} handle=".panel-drag" bounds="parent" defaultPosition={{ x: 0, y: 0 }}>
          <div
            ref={panelRef}
            className="absolute left-[76px] top-6 z-40 w-72 rounded-2xl border border-zinc-700/70 bg-zinc-900/95 backdrop-blur-md shadow-2xl overflow-hidden"
          >
            {/* Barra de título — handle de drag + fechar */}
            <div className="panel-drag cursor-grab active:cursor-grabbing flex items-center justify-between px-3 py-2 border-b border-zinc-800 select-none">
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-widest">{activeLabel}</span>
              <div className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-zinc-600" />
                  <span className="w-1 h-1 rounded-full bg-zinc-600" />
                  <span className="w-1 h-1 rounded-full bg-zinc-600" />
                </span>
                <button
                  type="button"
                  aria-label="Fechar painel"
                  onClick={() => onPanelOpenChange(false)}
                  className="text-zinc-500 hover:text-white transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            <div className="p-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 140px)" }}>
              {children}
            </div>
          </div>
        </Draggable>
      )}
    </TooltipProvider>
  );
}
