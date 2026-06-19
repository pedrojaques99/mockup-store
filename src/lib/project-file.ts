/**
 * project-file — bundle `.vsn` (Visant) do photo-mockup: um arquivo por projeto,
 * portátil entre máquinas. Zip (fflate) com tudo embutido:
 *
 *   projeto.vsn
 *    ├─ project.json   { v, doc, imgDims, tool, name, savedAt }
 *    ├─ photo.png      foto original (a fonte; render é derivado, não entra)
 *    └─ thumb.jpg      preview opcional
 *
 * Puro (sem DOM): só (de)serializa bytes. Fetch da foto, geração de thumb e o
 * download ficam no call site (page.tsx), onde há canvas/anchor.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { DEFAULT_DOC, type DocState } from "@/stores/editorDoc";

const SCHEMA = 1;
const JSON_ENTRY = "project.json";
const PHOTO_ENTRY = "photo.png";
const THUMB_ENTRY = "thumb.jpg";

export interface ProjectMeta {
  doc: DocState;
  imgDims: { w: number; h: number };
  tool: string;
  name: string;
}

interface ProjectJson extends ProjectMeta {
  v: number;
  savedAt: number;
}

export interface PackInput extends ProjectMeta {
  photoBytes: Uint8Array;
  thumbBytes?: Uint8Array;
  /** Epoch ms — passado de fora (Date.now() não roda em alguns contextos). */
  savedAt: number;
}

/** Serializa o projeto num bundle `.vsn` (Uint8Array pronto pra download). */
export function packProject(input: PackInput): Uint8Array {
  const json: ProjectJson = {
    v: SCHEMA,
    doc: input.doc,
    imgDims: input.imgDims,
    tool: input.tool,
    name: input.name,
    savedAt: input.savedAt,
  };
  const files: Record<string, Uint8Array> = {
    [JSON_ENTRY]: strToU8(JSON.stringify(json)),
    [PHOTO_ENTRY]: input.photoBytes,
  };
  if (input.thumbBytes) files[THUMB_ENTRY] = input.thumbBytes;
  // photo/thumb já são comprimidos (png/jpg) → level 0 neles evita recompressão cara;
  // o json é pequeno, comprime barato.
  return zipSync(files, { level: 6 });
}

export interface UnpackResult extends ProjectMeta {
  photoBytes: Uint8Array;
}

/** Lê um bundle `.vsn`. Lança se schema/shape inválidos (arquivo corrompido/alheio). */
export function unpackProject(bytes: Uint8Array): UnpackResult {
  const files = unzipSync(bytes);
  const rawJson = files[JSON_ENTRY];
  const photoBytes = files[PHOTO_ENTRY];
  if (!rawJson) throw new Error("Arquivo .vsn inválido: falta project.json");
  if (!photoBytes) throw new Error("Arquivo .vsn inválido: falta a foto");

  const json = JSON.parse(strFromU8(rawJson)) as Partial<ProjectJson>;
  if (json.v !== SCHEMA) throw new Error(`Versão de projeto não suportada (v${json.v ?? "?"})`);
  if (!json.doc || typeof json.doc !== "object") throw new Error("Arquivo .vsn inválido: doc ausente");

  // Merge sobre o DEFAULT_DOC: tolera bundles antigos sem campos novos (forward-compat),
  // mas mantém só chaves conhecidas — sem vazar lixo pro state do editor.
  const doc = { ...DEFAULT_DOC, ...json.doc } as DocState;

  return {
    doc,
    imgDims: json.imgDims ?? { w: 0, h: 0 },
    tool: json.tool ?? "render",
    name: json.name ?? "projeto",
    photoBytes,
  };
}
