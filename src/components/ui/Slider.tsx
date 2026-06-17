"use client";

/** Boxy labeled range — the single source for every slider in the editor panels. */
import { cn } from "@/lib/utils";

export function Slider({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = "",
  accent = "acc",
  display,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  accent?: "acc" | "acc2";
  /** Override the right-aligned readout (defaults to `${value}${suffix}`). */
  display?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-0.5", className)}>
      <label className="text-[10px] text-zinc-400 flex items-center justify-between">
        <span className="flex items-center gap-1">
          {label}
          {hint && <span className="text-zinc-700">· {hint}</span>}
        </span>
        <span className="font-mono text-zinc-500">{display ?? `${value}${suffix}`}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn("w-full h-1", accent === "acc2" ? "accent-acc2" : "accent-acc")}
      />
    </div>
  );
}
