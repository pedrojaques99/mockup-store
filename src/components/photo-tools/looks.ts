/** SSoT for look presets + per-surface AI-blend defaults (shared page ↔ panels). */

/** Filtro CSS aproximado de um look — pro PREVIEW ao passar o mouse (sem re-render). */
export function lookCssFilter(p: { warmth: number; saturation: number; brightness: number }): string {
  const parts = [`saturate(${p.saturation}%)`, `brightness(${p.brightness}%)`];
  if (p.warmth > 0) parts.push(`sepia(${(p.warmth / 100 * 0.35).toFixed(2)})`);
  else if (p.warmth < 0) parts.push(`hue-rotate(${Math.round(p.warmth / 100 * 18)}deg)`, "saturate(108%)");
  return parts.join(" ");
}

/**
 * Filtro CSS do DELTA entre o fx ATUAL e o já "baked" no render exibido — preview
 * instantâneo (Tier 3) enquanto o servidor recompõe. cur==baked → neutro (sem overshoot).
 * Só saturação/claridade (compõem multiplicativo no CSS); contraste/calor/grão re-bake
 * no commit do servidor. Retorna null quando não há diferença visível.
 */
export function liveLookDelta(
  cur: { saturation: number; brightness: number },
  baked: { saturation: number; brightness: number },
): string | null {
  const sat = baked.saturation ? cur.saturation / baked.saturation : 1;
  const bri = baked.brightness ? cur.brightness / baked.brightness : 1;
  if (Math.abs(sat - 1) < 0.002 && Math.abs(bri - 1) < 0.002) return null;
  return `saturate(${(sat * 100).toFixed(1)}%) brightness(${(bri * 100).toFixed(1)}%)`;
}

export const LOOK_PRESETS = [
  { name: "Natural", grain: 0,  warmth: 0,   saturation: 100, brightness: 100 },
  { name: "Quente",  grain: 5,  warmth: 30,  saturation: 110, brightness: 102 },
  { name: "Cold",    grain: 5,  warmth: -30, saturation: 95,  brightness: 100 },
  { name: "Fosco",   grain: 15, warmth: 5,   saturation: 75,  brightness: 95  },
  { name: "Vívido",  grain: 0,  warmth: 0,   saturation: 145, brightness: 105 },
  { name: "P&B",     grain: 18, warmth: 0,   saturation: 0,   brightness: 100 },
] as const;

export const AI_BLEND_DEFAULTS: Record<string, { enabled: boolean; strength: number; texture: boolean; textureOpacity: number }> = {
  fabric:    { enabled: true,  strength: 0.40, texture: true,  textureOpacity: 0.30 },
  tshirt:    { enabled: true,  strength: 0.40, texture: true,  textureOpacity: 0.30 },
  bag:       { enabled: true,  strength: 0.35, texture: true,  textureOpacity: 0.25 },
  wall:      { enabled: true,  strength: 0.30, texture: true,  textureOpacity: 0.20 },
  box:       { enabled: true,  strength: 0.25, texture: true,  textureOpacity: 0.20 },
  billboard: { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  poster:    { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  card:      { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  paper:     { enabled: false, strength: 0.15, texture: false, textureOpacity: 0.15 },
  screen:    { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.00 },
};
