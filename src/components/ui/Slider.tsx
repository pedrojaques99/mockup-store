"use client";

/** Boxy labeled range — the single source for every slider in the editor panels.
 *  Feedback: o valor realça enquanto arrasta; se `defaultValue` for passado, um
 *  dot `acc` indica "alterado" e duplo-clique reseta ao default. */
import { useState } from "react";
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
  defaultValue,
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
  /** Default p/ duplo-clique resetar + dot de "alterado". */
  defaultValue?: number;
}) {
  const [active, setActive] = useState(false);
  const accCls = accent === "acc2" ? "text-acc2" : "text-acc";
  const changed = defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-6;
  return (
    <div className={cn("space-y-0.5", className)}>
      <label className="text-[10px] text-zinc-400 flex items-center justify-between">
        <span className="flex items-center gap-1">
          {label}
          {hint && <span className="text-zinc-700">· {hint}</span>}
          {changed && <span className={cn("w-1 h-1 rounded-full inline-block", accent === "acc2" ? "bg-acc2" : "bg-acc")} title="alterado — duplo-clique reseta" />}
        </span>
        <span className={cn("font-mono transition-colors", active ? accCls : "text-zinc-500")}>{display ?? `${value}${suffix}`}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={() => setActive(true)}
        onPointerUp={() => setActive(false)}
        onPointerCancel={() => setActive(false)}
        onBlur={() => setActive(false)}
        onDoubleClick={() => { if (defaultValue !== undefined) onChange(defaultValue); }}
        title={defaultValue !== undefined ? "Duplo-clique reseta ao padrão" : undefined}
        className={cn("w-full h-1", accent === "acc2" ? "accent-acc2" : "accent-acc")}
      />
    </div>
  );
}
