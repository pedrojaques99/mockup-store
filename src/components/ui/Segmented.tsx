"use client";

/** Boxy segmented control — the acc2-active pill row used across tool panels. */
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "py-1.5 rounded-lg text-[10px] font-medium border transition-colors",
            value === o.value
              ? "bg-acc2 text-zinc-950 border-acc2"
              : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
