"use client";

/**
 * Popover — Radix behaviour (positioning, click-outside, ESC, focus, a11y),
 * Boxy skin (zinc/acc2 tokens). Used to anchor a tool's panel to its rail icon.
 */
import * as RP from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverAnchor = RP.Anchor;

export function PopoverContent({
  className,
  side = "right",
  align = "start",
  sideOffset = 12,
  collisionPadding = 12,
  children,
  ...props
}: React.ComponentProps<typeof RP.Content>) {
  return (
    <RP.Portal>
      <RP.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "z-40 w-72 max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-neutral-700/70 bg-neutral-900/95 backdrop-blur-md p-3 text-neutral-200 shadow-2xl outline-none",
          "transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
          className
        )}
        {...props}
      >
        {children}
      </RP.Content>
    </RP.Portal>
  );
}
