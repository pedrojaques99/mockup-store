/**
 * SSoT for the photo-mockup tool set. The rail, keyboard map, and panels all
 * derive from this list — add a tool here and wire its panel branch, nothing else.
 */
import { Frame, Lasso, Droplets, ImageIcon, Sun, Crop, ZoomIn, Wand2 } from "lucide-react";
import type { RailTool } from "./ToolRail";

export type PhotoTool = "corners" | "mask" | "reflect" | "luz" | "aiedit" | "crop" | "upscale" | "render";

/** Mask-editor instruments (the "how"). The mask itself is the target (the "what").
 *  Pen is an instrument, never a category. */
export type MaskInstrument = "pen" | "brush" | "wand" | "sam";
/** @deprecated use MaskInstrument */
export type MaskMethod = MaskInstrument;
/** Which mask a mask edit targets. */
export type MaskTarget = "surface" | "occluder";
/** Composite mode for every instrument. */
export type MaskMode = "add" | "sub";

export const PHOTO_TOOLS: RailTool<PhotoTool>[] = [
  { id: "corners", label: "Cantos", icon: Frame, group: "edit" },
  { id: "mask", label: "Máscara", icon: Lasso, group: "edit" },
  { id: "reflect", label: "Reflexo", icon: Droplets, group: "edit" },
  { id: "luz", label: "Luz", icon: Sun, group: "edit" },
  { id: "aiedit", label: "IA", icon: Wand2, group: "edit" },
  { id: "crop", label: "Cortar", icon: Crop, group: "process" },
  { id: "upscale", label: "Aumentar", icon: ZoomIn, group: "process" },
  { id: "render", label: "Render", icon: ImageIcon, group: "output" },
];

/** Single-key shortcuts → tool. */
export const PHOTO_TOOL_KEYS: Record<string, PhotoTool> = {
  c: "corners",
  m: "mask",
  r: "reflect",
  l: "luz",
  i: "aiedit",
  p: "crop",
  u: "upscale",
  v: "render",
};
