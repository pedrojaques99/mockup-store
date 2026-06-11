// Matches common smart-object placeholder names across PSD templates (PT-BR + EN).
// Unescaped dots match both "." and " " — e.g. design.here matches "Design Here".
// \b boundaries prevent false matches on "particles", "start", etc.
export const SO_TARGET = /double.click|your.design|place.here|smart.object|\bartwork\b|\bdesign.here\b|\bedit(e|ar)?\b|\barte\b|\baqui\b|\bhere\b/i;
// Only patterns that are UNAMBIGUOUSLY watermarks/toggles — never real content layer names.
// Broad patterns (design, guide, extra, bare "delete") were killing content layers in BOXY PSDs.
export const BRAND_HIDE = /\[boxy\]|remove\s*paper|\byour\s+artwork\b|\bimage\s+here\b|\btext\s+here\b|\blogo\s+here\b|delete\s+(essa\s+camada|this)\b/i;
export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
// Smart objects decorativos (sombra/luz/textura) — nunca são faces editáveis.
// Usado só para agrupar faces; nunca esconde camadas.
export const SO_DECOR = /\bsombra\b|\bshadows?\b|\bluz\b|\blights?\b|\bgrain\b|\btextur\w*|\beffects?\b|\bmesh\b|\bbackground\b|\breflex\w*|\bnoise\b|\boverlay\b|\bdisplace\w*|\bblur\b|\bglow\b|\bbase\b/i;
