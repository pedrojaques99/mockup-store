"use client";

/**
 * Tooltip — Radix behaviour, Boxy skin. Labels the icon-only rail buttons.
 * Wrap the app (or the rail) once in <TooltipProvider>.
 */
import * as RT from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = RT.Provider;

export function Tooltip({
  label,
  children,
  side = "right",
  sideOffset = 8,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={sideOffset}
          className={cn(
            "z-50 rounded-md border border-zinc-700/60 bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 shadow-lg select-none"
          )}
        >
          {label}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
