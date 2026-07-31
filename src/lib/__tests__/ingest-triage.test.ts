import { describe, it, expect } from "vitest";
import {
  triage,
  junkReason,
  hammingHex,
  contentKey,
  defaultSelection,
  PHASH_THRESHOLD,
  type ScanCandidate,
} from "../ingest-triage";

const c = (over: Partial<ScanCandidate> & { name: string }): ScanCandidate => ({
  path: `H:/Mockups/${over.name}${over.ext ?? ".jpg"}`,
  ext: ".jpg",
  sizeBytes: 500_000,
  folder: "Mockups",
  ...over,
});

const empty = { existingSignatures: new Set<string>(), existingPaths: new Set<string>() };

describe("junkReason", () => {
  it("reprova arquivo vazio", () => {
    expect(junkReason(c({ name: "a", sizeBytes: 0 }))).toBe("arquivo vazio");
  });

  it("reprova thumbnail por tamanho", () => {
    expect(junkReason(c({ name: "billboard", sizeBytes: 4_000 }))).toMatch(/minúsculo/);
  });

  it("reprova por resolução, mesmo com arquivo pesado", () => {
    expect(junkReason(c({ name: "logo", sizeBytes: 900_000, width: 120, height: 900 }))).toMatch(
      /resolução baixa/,
    );
  });

  it("reprova sufixo de derivado", () => {
    expect(junkReason(c({ name: "billboard_thumb" }))).toMatch(/derivado/);
    expect(junkReason(c({ name: "cena-preview" }))).toMatch(/derivado/);
  });

  it("reprova arquivo de sistema", () => {
    expect(junkReason(c({ name: "Thumbs" }))).toBe("arquivo de sistema");
  });

  it("aprova um mockup normal", () => {
    expect(junkReason(c({ name: "Billboard Paulista", width: 1920, height: 1080 }))).toBeNull();
  });

  it("PSD escapa das regras de pixel — um PSD pequeno ainda é um PSD", () => {
    expect(junkReason(c({ name: "badge", ext: ".psd", sizeBytes: 2_000 }))).toBeNull();
    // …mas não escapa das de sistema/vazio.
    expect(junkReason(c({ name: "x", ext: ".psd", sizeBytes: 0 }))).toBe("arquivo vazio");
  });
});

describe("hammingHex", () => {
  it("hash igual tem distância zero", () => {
    expect(hammingHex("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
  });

  it("conta bits diferentes, não caracteres", () => {
    // 0x0 vs 0xf = 4 bits.
    expect(hammingHex("0000000000000000", "f000000000000000")).toBe(4);
    // 0x0 vs 0x1 = 1 bit.
    expect(hammingHex("0000000000000000", "1000000000000000")).toBe(1);
  });

  it("tamanhos diferentes nunca casam", () => {
    expect(hammingHex("ff", "ffff")).toBeGreaterThan(64);
  });
});

describe("triage", () => {
  it("marca como novo o que não tem par nem problema", () => {
    const { items, summary } = triage({
      candidates: [c({ name: "Billboard", phash: "0f0f0f0f0f0f0f0f", width: 1920, height: 1080 })],
      ...empty,
    });
    expect(items[0].verdict).toBe("new");
    expect(summary.new).toBe(1);
  });

  it("agrupa duplicata idêntica e elege UM representante", () => {
    const { items, summary } = triage({
      candidates: [
        c({ name: "Billboard (2)", phash: "aaaaaaaaaaaaaaaa", width: 1920, height: 1080 }),
        c({ name: "Billboard", phash: "aaaaaaaaaaaaaaaa", width: 1920, height: 1080 }),
      ],
      ...empty,
    });
    expect(summary.new).toBe(1);
    expect(summary.duplicate).toBe(1);
    // O nome limpo vence o "(2)" — mesma regra de keepScore que o grid usa.
    const leader = items.find((i) => i.verdict === "new")!;
    expect(leader.name).toBe("Billboard");
    expect(items.find((i) => i.verdict === "duplicate")!.reason).toMatch(/cópia de Billboard/);
  });

  it("funde quase-duplicatas dentro do limiar perceptual", () => {
    // Um bit de diferença — o mesmo mockup reexportado.
    const { summary } = triage({
      candidates: [
        c({ name: "Cena A", phash: "0000000000000000", width: 1920, height: 1080 }),
        c({ name: "Cena B", phash: "1000000000000000", width: 1920, height: 1080 }),
      ],
      ...empty,
    });
    expect(summary.new).toBe(1);
    expect(summary.duplicate).toBe(1);
  });

  it("NÃO funde imagens genuinamente diferentes", () => {
    const { summary } = triage({
      candidates: [
        c({ name: "Cena A", phash: "0000000000000000", width: 1920, height: 1080 }),
        c({ name: "Cena B", phash: "ffffffffffffffff", width: 1920, height: 1080 }),
      ],
      ...empty,
    });
    expect(hammingHex("0000000000000000", "ffffffffffffffff")).toBeGreaterThan(PHASH_THRESHOLD);
    expect(summary.new).toBe(2);
    expect(summary.duplicate).toBe(0);
  });

  it("lixo é decidido ANTES de duplicata — o representante nunca é o thumbnail", () => {
    const { items } = triage({
      candidates: [
        c({ name: "billboard_thumb", phash: "aaaaaaaaaaaaaaaa", sizeBytes: 3_000 }),
        c({ name: "billboard", phash: "aaaaaaaaaaaaaaaa", width: 1920, height: 1080 }),
      ],
      ...empty,
    });
    expect(items.find((i) => i.name === "billboard_thumb")!.verdict).toBe("junk");
    expect(items.find((i) => i.name === "billboard")!.verdict).toBe("new");
  });

  it("reconhece o que já está no acervo pela assinatura do projeto", () => {
    const cand = c({ name: "Billboard", sizeBytes: 500_000, width: 1920, height: 1080 });
    const { items } = triage({
      candidates: [cand],
      existingPaths: new Set(),
      // mockupSignature normaliza nome + bucket de KB — "Billboard-(1)" casa.
      existingSignatures: new Set(["billboard::488"]),
    });
    expect(items[0].verdict).toBe("exists");
  });

  it("caminho já ingerido vence qualquer heurística", () => {
    const cand = c({ name: "qualquer", ext: ".psd" });
    const { items } = triage({
      candidates: [cand],
      existingSignatures: new Set(),
      existingPaths: new Set([cand.path]),
    });
    expect(items[0].verdict).toBe("exists");
    expect(items[0].reason).toBe("já ingerido");
  });

  it("casa a imagem com o PSD de mesmo nome", () => {
    const { items } = triage({
      candidates: [
        c({ name: "Billboard", ext: ".psd", sizeBytes: 90_000_000, contentHash: "x" }),
        c({ name: "Billboard", ext: ".jpg", phash: "0f0f0f0f0f0f0f0f", width: 1920, height: 1080 }),
      ],
      ...empty,
    });
    const img = items.find((i) => i.ext === ".jpg")!;
    expect(img.psdPath).toMatch(/Billboard\.psd$/);
  });

  it("soma os bytes que ficam de fora", () => {
    const { summary } = triage({
      candidates: [
        c({ name: "ok", phash: "0f0f0f0f0f0f0f0f", width: 1920, height: 1080 }),
        c({ name: "lixo_thumb", sizeBytes: 1_000 }),
      ],
      ...empty,
    });
    expect(summary.junk).toBe(1);
    expect(summary.skippedBytes).toBe(1_000);
  });
});

describe("contentKey", () => {
  it("prefere perceptual, depois conteúdo, depois nome+tamanho", () => {
    expect(contentKey(c({ name: "a", phash: "abc", contentHash: "zzz" }))).toBe("p:abc");
    expect(contentKey(c({ name: "a", contentHash: "zzz" }))).toBe("c:zzz");
    expect(contentKey(c({ name: "a" }))).toMatch(/^n:/);
  });
});

describe("defaultSelection", () => {
  it("marca só o que é novo — o default é a estratégia", () => {
    const { items } = triage({
      candidates: [
        c({ name: "novo", phash: "0f0f0f0f0f0f0f0f", width: 1920, height: 1080 }),
        c({ name: "lixo_thumb", sizeBytes: 900 }),
      ],
      ...empty,
    });
    const sel = defaultSelection(items);
    expect(sel.size).toBe(1);
    expect([...sel][0]).toMatch(/novo\.jpg$/);
  });
});
