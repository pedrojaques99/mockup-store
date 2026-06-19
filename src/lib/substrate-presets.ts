/**
 * substrate-presets — biblioteca de **substratos/objetos** detectáveis em mockups.
 *
 * Placeholder (magenta / white / none) é ORTOGONAL ao substrato. Uma cena pode
 * ter um placeholder magenta numa camiseta (drape), num billboard (flat), numa
 * garrafa (cylinder), etc. Por isso o `SmartPreset` se compõe de:
 *   • detector method (key-color | white | manual) — vem do placeholder.
 *   • surfaceType + material + disp + form factor — vem do substrato.
 *   • mesh form (`flat | slight | drape | cylinder`) → gera a malha pré-curvada.
 *
 * Esta tabela é o coração do "smart preset". Adicionar substrato = entrar aqui +
 * adicionar score em `substrate-detect.ts`. Tudo o mais segue de graça.
 */
import type { MaterialKind } from "./material-fx";

export type SubstrateKind =
  | "paper" | "card" | "fabric_tshirt" | "fabric_bag" | "canvas"
  | "banner" | "billboard" | "screen" | "glass" | "metal"
  | "concrete" | "wood" | "bottle" | "tube" | "mug" | "wet";

/** Forma da malha — define como `smart-mesh` gera os pontos de controle. */
export type FormFactor = "flat" | "slight" | "drape" | "cylinder";

export interface SubstratePreset {
  kind: SubstrateKind;
  label: string;              // ptBR pra UI
  surfaceType: string;        // billboard | poster | card | wall | fabric | other
  material: MaterialKind;     // none | fabric | metal | glass | worn | shadow
  materialIntensity: number;
  materialAngle: number;
  materialScale: number;
  dispScale: number;          // amplitude (px)
  dispBlur: number;
  /** Forma da malha gerada quando o usuário pede "Aplicar smart mesh". */
  form: FormFactor;
  /** Densidade default (rows=cols). Cylinders/drapes pedem mais. */
  meshDensity: number;
  /** Hint pra UI explicar a escolha. */
  hint: string;
}

export const SUBSTRATES: Record<SubstrateKind, SubstratePreset> = {
  paper:         { kind: "paper",         label: "Papel",            surfaceType: "paper",     material: "none",   materialIntensity: 0.3,  materialAngle: 0,   materialScale: 8,  dispScale: 6,  dispBlur: 8,  form: "flat",     meshDensity: 3, hint: "papel liso / kraft (relevo leve)" },
  card:          { kind: "card",          label: "Cartão",           surfaceType: "card",      material: "none",   materialIntensity: 0.25, materialAngle: 0,   materialScale: 8,  dispScale: 0,  dispBlur: 4,  form: "flat",     meshDensity: 2, hint: "cartão fino, plano" },
  fabric_tshirt: { kind: "fabric_tshirt", label: "Camiseta",         surfaceType: "fabric",    material: "fabric", materialIntensity: 0.55, materialAngle: 35,  materialScale: 6,  dispScale: 14, dispBlur: 12, form: "drape",    meshDensity: 5, hint: "malha de algodão, dobra suave" },
  fabric_bag:    { kind: "fabric_bag",    label: "Tote/Bag",         surfaceType: "fabric",    material: "fabric", materialIntensity: 0.55, materialAngle: 30,  materialScale: 7,  dispScale: 12, dispBlur: 10, form: "drape",    meshDensity: 4, hint: "lona pesada, drape" },
  canvas:        { kind: "canvas",        label: "Tela/Canvas",      surfaceType: "fabric",    material: "fabric", materialIntensity: 0.45, materialAngle: 35,  materialScale: 6,  dispScale: 8,  dispBlur: 10, form: "slight",   meshDensity: 4, hint: "tela esticada, ondulação leve" },
  banner:        { kind: "banner",        label: "Banner",           surfaceType: "billboard", material: "none",   materialIntensity: 0.3,  materialAngle: 0,   materialScale: 6,  dispScale: 4,  dispBlur: 8,  form: "slight",   meshDensity: 4, hint: "lona/banner — ondulação fina" },
  billboard:     { kind: "billboard",     label: "Outdoor",          surfaceType: "billboard", material: "none",   materialIntensity: 0,    materialAngle: 0,   materialScale: 6,  dispScale: 2,  dispBlur: 4,  form: "flat",     meshDensity: 3, hint: "outdoor liso, plano" },
  screen:        { kind: "screen",        label: "Tela LED/LCD",     surfaceType: "card",      material: "glass",  materialIntensity: 0.25, materialAngle: 25,  materialScale: 4,  dispScale: 0,  dispBlur: 2,  form: "flat",     meshDensity: 2, hint: "display digital, perfeitamente plano" },
  glass:         { kind: "glass",         label: "Vidro",            surfaceType: "card",      material: "glass",  materialIntensity: 0.4,  materialAngle: 30,  materialScale: 5,  dispScale: 2,  dispBlur: 6,  form: "flat",     meshDensity: 2, hint: "vidro / vitrine — reflexo" },
  metal:         { kind: "metal",         label: "Metal",            surfaceType: "card",      material: "metal",  materialIntensity: 0.45, materialAngle: 25,  materialScale: 6,  dispScale: 4,  dispBlur: 6,  form: "flat",     meshDensity: 3, hint: "placa metálica, brilho direcional" },
  concrete:      { kind: "concrete",      label: "Concreto/Parede",  surfaceType: "wall",      material: "worn",   materialIntensity: 0.65, materialAngle: 40,  materialScale: 5,  dispScale: 12, dispBlur: 14, form: "flat",     meshDensity: 4, hint: "parede rugosa — captar textura" },
  wood:          { kind: "wood",          label: "Madeira",          surfaceType: "wall",      material: "worn",   materialIntensity: 0.5,  materialAngle: 25,  materialScale: 7,  dispScale: 8,  dispBlur: 12, form: "flat",     meshDensity: 3, hint: "madeira — grão leve" },
  bottle:        { kind: "bottle",        label: "Garrafa",          surfaceType: "other",     material: "glass",  materialIntensity: 0.5,  materialAngle: 25,  materialScale: 5,  dispScale: 16, dispBlur: 10, form: "cylinder", meshDensity: 5, hint: "cilíndrico — malha curvada" },
  tube:          { kind: "tube",          label: "Bisnaga/Tubo",     surfaceType: "other",     material: "fabric", materialIntensity: 0.5,  materialAngle: 35,  materialScale: 6,  dispScale: 18, dispBlur: 14, form: "cylinder", meshDensity: 5, hint: "tubo flexível — curvado + amassado" },
  mug:           { kind: "mug",           label: "Caneca",           surfaceType: "other",     material: "metal",  materialIntensity: 0.35, materialAngle: 30,  materialScale: 5,  dispScale: 12, dispBlur: 10, form: "cylinder", meshDensity: 4, hint: "cilindro reto — caneca/lata" },
  wet:           { kind: "wet",           label: "Molhado/Reflexo",  surfaceType: "fabric",    material: "glass",  materialIntensity: 0.55, materialAngle: 30,  materialScale: 6,  dispScale: 16, dispBlur: 8,  form: "drape",    meshDensity: 4, hint: "superfície molhada — reflexo + drape" },
};

export const SUBSTRATE_KEYS: SubstrateKind[] = Object.keys(SUBSTRATES) as SubstrateKind[];
