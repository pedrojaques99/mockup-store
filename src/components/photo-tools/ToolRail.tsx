"use client";

/**
 * ToolRail — floating, icon-only vertical rail (left edge). Data-driven from a
 * RailTool[] registry. A SINGLE Radix Popover is anchored to the active icon
 * (PopoverAnchor), so the panel (`children`) tracks whichever tool is active;
 * Radix handles positioning / click-outside / ESC. Boxy skin (zinc / acc2).
 *
 * Selection model: clicking an inactive tool selects it + opens the panel;
 * clicking the active tool toggles the panel; ESC / click-outside closes the
 * panel but keeps the tool active (its canvas overlay stays).
 */
import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/Popover";
import { Tooltip, TooltipProvider } from "@/components/ui/Tooltip";

export interface RailTool<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** Consecutive tools sharing a group render together; a divider separates groups. */
  group?: string;
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
  const groups: RailTool<T>[][] = [];
  let lastGroup: string | undefined;
  tools.forEach((t, i) => {
    if (i === 0 || t.group !== lastGroup) groups.push([]);
    groups[groups.length - 1].push(t);
    lastGroup = t.group;
  });

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100}>
      <Popover open={panelOpen} onOpenChange={onPanelOpenChange}>
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1 rounded-2xl border border-zinc-700/60 bg-zinc-900/90 backdrop-blur-md p-1.5 shadow-2xl">
          {groups.map((grp, gi) => (
            <Fragment key={gi}>
              {gi > 0 && <div className="mx-2 my-1 h-px bg-zinc-700/50" />}
              {grp.map((t) => {
                const isActive = t.id === active;
                const Icon = t.icon;
                const btn = (
                  <button
                    type="button"
                    aria-label={t.label}
                    aria-pressed={isActive}
                    onClick={() => {
                      if (isActive) onPanelOpenChange(!panelOpen);
                      else { onSelect(t.id); onPanelOpenChange(true); }
                    }}
                    className={cn(
                      "grid place-items-center w-10 h-10 rounded-xl transition-colors",
                      isActive ? "bg-acc2 text-zinc-950" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    )}
                  >
                    <Icon size={18} strokeWidth={2} />
                  </button>
                );
                return (
                  <Tooltip key={t.id} label={t.label}>
                    {isActive ? <PopoverAnchor asChild>{btn}</PopoverAnchor> : btn}
                  </Tooltip>
                );
              })}
            </Fragment>
          ))}
        </div>
        <PopoverContent>{children}</PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
