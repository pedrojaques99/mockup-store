/**
 * Testes das partes PURAS da camada densa — zero rede.
 *
 * O que dá pra provar sem chave de API é justamente o que costuma quebrar em silêncio:
 * o texto que vira embedding, o (de)serializar do Float32Array, a ordem do produto
 * escalar, a tolerância a linha podre no jsonl — e, principalmente, que **com embeddings
 * desligados nada explode**: tudo devolve `null`/`skipped` e a busca segue léxica.
 *
 * O diretório de cache é apontado para um tmpdir por `SEARCH_CACHE_DIR`, então nenhum
 * teste encosta no `.tmp/search/` do projeto.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const DIR = mkdtempSync(join(tmpdir(), "semantic-index-"));
process.env.SEARCH_CACHE_DIR = DIR;
process.env.EMBEDDINGS_PROVIDER = "off";

import {
  docText, hashText, encodeVec, decodeVec, parseVecLines, rankByDot, centroidOf,
  getVectors, ensureEmbeddings, semanticRank, centroidRank, semanticStats,
  invalidateSemanticCache,
} from "../semantic-index";
import { isEmbeddingsEnabled, getEmbeddingsConfig, embedFingerprint, resetEmbeddingsConfig } from "../embeddings";
import type { SearchDoc } from "../search-engine";

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

beforeEach(() => {
  process.env.SEARCH_CACHE_DIR = DIR;
  process.env.EMBEDDINGS_PROVIDER = "off";
  resetEmbeddingsConfig();
  invalidateSemanticCache();
});

function doc(over: Partial<SearchDoc> = {}): SearchDoc {
  return {
    id: "a", name: "Outdoor Avenida", studio: "BOXY", description: "billboard photo mockup",
    tags: ["urbano", "rua"], mockupType: ["billboard"], source: "fs", ...over,
  };
}

const vec = (...n: number[]) => Float32Array.from(n);

describe("docText", () => {
  it("é estável e junta os campos que o card mostra", () => {
    const t = docText(doc());
    expect(t).toBe(docText(doc()));
    for (const piece of ["Outdoor Avenida", "BOXY", "billboard", "urbano", "rua"]) {
      expect(t).toContain(piece);
    }
  });

  it("não leva campo técnico (caminho de PSD, smart object) para o espaço vetorial", () => {
    const t = docText(doc({ psdPath: "Z:/acervo/x.psd", smartObjectName: "SO_TARGET" } as Partial<SearchDoc>));
    expect(t).not.toContain("acervo");
    expect(t).not.toContain("SO_TARGET");
  });

  it("aguenta doc sem tags/mockupType sem virar string com separador solto", () => {
    const t = docText({ name: "Só nome", studio: "", description: "", tags: [], mockupType: [] });
    expect(t).toBe("Só nome");
  });

  it("hash muda quando o texto muda (é o gatilho do re-embed)", () => {
    expect(hashText(docText(doc()))).toBe(hashText(docText(doc())));
    expect(hashText(docText(doc()))).not.toBe(hashText(docText(doc({ tags: ["praia"] }))));
  });
});

describe("encode/decode de vetor", () => {
  it("faz round-trip exato em base64", () => {
    const v = vec(0.5, -0.25, 0.125, 1, -1, 0);
    const back = decodeVec(encodeVec(v));
    expect(back.length).toBe(v.length);
    expect([...back]).toEqual([...v]);
  });

  it("sobrevive a vetor grande (512 dims, o default da config)", () => {
    const v = Float32Array.from({ length: 512 }, (_, i) => Math.sin(i) / 10);
    const back = decodeVec(encodeVec(v));
    expect(back.length).toBe(512);
    expect(back[511]).toBeCloseTo(v[511], 6);
  });
});

describe("parseVecLines", () => {
  it("pula linha corrompida em vez de explodir", () => {
    const good = JSON.stringify({ id: "a", hash: "h", fp: "f", dims: 2, vec: encodeVec(vec(1, 0)) });
    const rows = parseVecLines(
      [good, "{isso não é json", "", '{"semId":true}', JSON.stringify({ id: "b", vec: encodeVec(vec(0, 1)) })].join("\n"),
    );
    expect([...rows.keys()]).toEqual(["a", "b"]);
    expect(rows.get("b")!.hash).toBe("");
  });

  it("última linha do mesmo id vence (o arquivo é append-only entre reescritas)", () => {
    const rows = parseVecLines(
      [
        JSON.stringify({ id: "a", hash: "velho", fp: "f", dims: 1, vec: encodeVec(vec(1)) }),
        JSON.stringify({ id: "a", hash: "novo", fp: "f", dims: 1, vec: encodeVec(vec(1)) }),
      ].join("\n"),
    );
    expect(rows.get("a")!.hash).toBe("novo");
  });
});

describe("rankByDot", () => {
  const vectors = new Map<string, Float32Array>([
    ["perto", vec(1, 0)],
    ["meio", vec(0.7071, 0.7071)],
    ["longe", vec(0, 1)],
    ["oposto", vec(-1, 0)],
  ]);

  it("ordena por produto escalar, do mais parecido ao menos", () => {
    const out = rankByDot(vec(1, 0), vectors, { minScore: -1 }).map((r) => r.id);
    expect(out).toEqual(["perto", "meio", "longe", "oposto"]);
  });

  it("corta em k", () => {
    expect(rankByDot(vec(1, 0), vectors, { k: 2, minScore: -1 })).toHaveLength(2);
  });

  it("aplica o piso de similaridade (default derruba o ortogonal e o oposto)", () => {
    expect(rankByDot(vec(1, 0), vectors).map((r) => r.id)).toEqual(["perto", "meio"]);
  });

  it("respeita o recorte de ids (facetas cortam antes do vetor)", () => {
    const out = rankByDot(vec(1, 0), vectors, { ids: new Set(["meio", "longe"]), minScore: -1 });
    expect(out.map((r) => r.id)).toEqual(["meio", "longe"]);
  });

  it("ignora vetor de dimensão diferente em vez de comparar pela metade", () => {
    const mixed = new Map(vectors);
    mixed.set("outro-modelo", vec(1, 0, 0, 0));
    expect(rankByDot(vec(1, 0), mixed, { minScore: -1 }).map((r) => r.id)).not.toContain("outro-modelo");
  });

  it("desempata por id — mesma entrada, mesma saída", () => {
    const tie = new Map([["z", vec(1, 0)], ["a", vec(1, 0)]]);
    expect(rankByDot(vec(1, 0), tie).map((r) => r.id)).toEqual(["a", "z"]);
  });
});

describe("centroidOf", () => {
  it("devolve o meio do caminho, normalizado", () => {
    const c = centroidOf([vec(1, 0), vec(0, 1)])!;
    expect(c[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.hypot(c[0], c[1])).toBeCloseTo(1, 5);
  });

  it("devolve null sem sementes", () => {
    expect(centroidOf([])).toBeNull();
  });
});

describe("getVectors", () => {
  it("lê o jsonl do disco, pulando a linha podre", async () => {
    writeFileSync(
      join(DIR, "embeddings.jsonl"),
      [
        JSON.stringify({ id: "a", hash: "h", fp: "off", dims: 2, vec: encodeVec(vec(1, 0)) }),
        "linha morta",
        JSON.stringify({ id: "b", hash: "h", fp: "off", dims: 2, vec: encodeVec(vec(0, 1)) }),
      ].join("\n") + "\n",
    );
    invalidateSemanticCache();
    const vectors = await getVectors();
    expect([...vectors.keys()].sort()).toEqual(["a", "b"]);
    expect([...vectors.get("a")!]).toEqual([1, 0]);
  });

  it("devolve mapa vazio quando o cache não existe", async () => {
    process.env.SEARCH_CACHE_DIR = join(DIR, "vazio");
    invalidateSemanticCache();
    expect((await getVectors()).size).toBe(0);
  });
});

describe("com embeddings desligados (EMBEDDINGS_PROVIDER=off)", () => {
  it("a config some e o fingerprint vira 'off'", () => {
    expect(getEmbeddingsConfig()).toBeNull();
    expect(isEmbeddingsEnabled()).toBe(false);
    expect(embedFingerprint()).toBe("off");
  });

  it("ensureEmbeddings avisa que pulou, sem tocar em rede nem em disco", async () => {
    expect(await ensureEmbeddings([doc()])).toEqual({ embedded: 0, cached: 0, skipped: true });
  });

  it("semanticRank e centroidRank devolvem null (a busca segue léxica)", async () => {
    expect(await semanticRank("engenharia")).toBeNull();
    expect(await centroidRank(["a", "b"])).toBeNull();
  });

  it("semanticRank também devolve null com query vazia", async () => {
    expect(await semanticRank("   ")).toBeNull();
  });

  it("semanticStats reporta desligado", async () => {
    expect(await semanticStats()).toEqual({ enabled: false, vectors: 0, model: null, dims: null });
  });
});

describe("resolução de provedor por env", () => {
  const snapshot = { ...process.env };
  const clean = () => {
    for (const k of ["EMBEDDINGS_PROVIDER", "EMBEDDINGS_BASE_URL", "EMBEDDINGS_MODEL", "EMBEDDINGS_API_KEY", "EMBEDDINGS_DIMS", "OPENAI_API_KEY", "NVIDIA_API_KEY"]) {
      delete process.env[k];
    }
    resetEmbeddingsConfig();
  };
  afterAll(() => { Object.assign(process.env, snapshot); resetEmbeddingsConfig(); });

  it("sem chave nenhuma ⇒ desligado (nunca lança)", () => {
    clean();
    expect(getEmbeddingsConfig()).toBeNull();
  });

  it("OPENAI_API_KEY sozinha auto-detecta openai com os defaults", () => {
    clean();
    process.env.OPENAI_API_KEY = "sk-teste";
    resetEmbeddingsConfig();
    expect(getEmbeddingsConfig()).toMatchObject({
      provider: "openai", model: "text-embedding-3-small", dims: 512, keyPresent: true,
    });
    expect(embedFingerprint()).toBe("openai:text-embedding-3-small:512");
  });

  it("NVIDIA_API_KEY sozinha auto-detecta nvidia com o baseURL compatível", () => {
    clean();
    process.env.NVIDIA_API_KEY = "nvapi-teste";
    resetEmbeddingsConfig();
    expect(getEmbeddingsConfig()).toMatchObject({
      provider: "nvidia",
      baseURL: "https://integrate.api.nvidia.com/v1",
      model: "nvidia/llama-3.2-nv-embedqa-1b-v2",
    });
  });

  it("provider=off vence qualquer chave presente", () => {
    clean();
    process.env.OPENAI_API_KEY = "sk-teste";
    process.env.EMBEDDINGS_PROVIDER = "off";
    resetEmbeddingsConfig();
    expect(isEmbeddingsEnabled()).toBe(false);
  });

  it("provider declarado sem chave nenhuma continua desligado", () => {
    clean();
    process.env.EMBEDDINGS_PROVIDER = "nvidia";
    resetEmbeddingsConfig();
    expect(getEmbeddingsConfig()).toBeNull();
  });

  it("trocar de modelo muda o fingerprint (é o que invalida o cache)", () => {
    clean();
    process.env.EMBEDDINGS_API_KEY = "k";
    process.env.EMBEDDINGS_PROVIDER = "openai";
    process.env.EMBEDDINGS_MODEL = "text-embedding-3-large";
    process.env.EMBEDDINGS_DIMS = "1024";
    resetEmbeddingsConfig();
    expect(embedFingerprint()).toBe("openai:text-embedding-3-large:1024");
  });
});
