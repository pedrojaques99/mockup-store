/**
 * SSoT for the photo-mockup tool set. The rail, keyboard map, and panels all
 * derive from this list — add a tool here and wire its panel branch, nothing else.
 */
import { Frame, Lasso, Droplets, ImageIcon, Sun, Crop, Scaling, Wand2, Grid3x3 } from "lucide-react";
import type { RailTool } from "./ToolRail";

export type PhotoTool = "corners" | "mask" | "reflect" | "luz" | "aiedit" | "crop" | "upscale" | "calibrate" | "render";

/** Mask-editor instruments (the "how"). The mask itself is the target (the "what").
 *  Pen is an instrument, never a category. */
export type MaskInstrument = "pen" | "brush" | "wand" | "sam";
/** @deprecated use MaskInstrument */
export type MaskMethod = MaskInstrument;
/** Which mask a mask edit targets. `aiedit` is independent from the render
 *  (surface/occluder) — it only drives the edit (inpaint) selection. */
export type MaskTarget = "surface" | "occluder" | "aiedit";
/** Composite mode for every instrument. */
export type MaskMode = "add" | "sub";

export const PHOTO_TOOLS: RailTool<PhotoTool>[] = [
  { id: "corners", label: "Cantos", icon: Frame, group: "edit", shortcut: "C" },
  { id: "mask", label: "Máscara", icon: Lasso, group: "edit", shortcut: "M" },
  { id: "reflect", label: "Reflexo", icon: Droplets, group: "edit", shortcut: "R" },
  { id: "luz", label: "Luz", icon: Sun, group: "edit", shortcut: "L" },
  { id: "aiedit", label: "Editar", icon: Wand2, group: "edit", shortcut: "E" },
  { id: "calibrate", label: "Superfície", icon: Grid3x3, group: "edit", shortcut: "S" },
  { id: "crop", label: "Cortar", icon: Crop, group: "process", shortcut: "P" },
  { id: "upscale", label: "Aumentar", icon: Scaling, group: "process", shortcut: "U" },
  { id: "render", label: "Render", icon: ImageIcon, group: "output", shortcut: "V" },
];

/** Single-key shortcuts → tool. */
export const PHOTO_TOOL_KEYS: Record<string, PhotoTool> = {
  c: "corners",
  m: "mask",
  r: "reflect",
  l: "luz",
  e: "aiedit",
  s: "calibrate",
  p: "crop",
  u: "upscale",
  v: "render",
};
