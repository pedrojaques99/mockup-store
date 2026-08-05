/**
 * Brand Mockup Kit — white-label. Pluga UMA marca do Visant Labs e metralha um
 * kit: N mockups com LAYOUTS (criativos do cliente) + N com LOGO/símbolo (faces
 * ~1:1), curando cena/PSD coerente. A marca (paleta + logo) vem do Visant.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/brand-kit.ts \
 *     --brand <visantId> --layouts "<dir criativos>" --out "<dir>" --count 10
 *
 *   # renderiza a coleção curada na home (ordem e escolha são do usuário):
 *   npx tsx --env-file=.env.local scripts/brand-kit.ts \
 *     --brand <visantId> --collection --layouts "<dir criativos>" --out "<dir>"
 *
 * Flags:
 *   --brand <id>      brand id da Visant (obrigatório; veja `agent-cli brands`)
 *   --layouts <dir>   criativos de campanha do cliente (metade "layouts")
 *   --out <dir>       saída (cria <out>/layouts e <out>/logo)
 *   --count <n>       mockups por metade (default 10)
 *   --collection      renderiza EXATAMENTE os mockups da coleção da marca, na
 *                     ordem curada (data/brand-collections.json). Um lote só:
 *                     com --layouts a arte é o criativo, senão é o logo/símbolo.
 *                     Incompatível com --count (quem conta é a curadoria).
 *   --symbol <p|url>  símbolo/ícone alta-res p/ a metade "logo" (override do logo
 *                     do Visant, que costuma ser lockup horizontal baixa-res)
 *   --mono            o símbolo é silhueta → recolore nas cores da marca (lime/dark)
 *   --only layouts|logo   roda só uma metade
 *   --max-crop <f>    0-1: descarta cenas cuja face force o `cover` a cortar mais
 *                     que isso da arte (0.12 recomendado p/ layout tipográfico)
 *   --preview         JPEG rápido   --fresh   ignora _summary e recomeça
 *   --help            esta ajuda
 *
 * Não reinventa: o render/curadoria é o brand-mockup-batch.ts; este orquestrador
 * só pluga a marca do Visant + prepara as artes 1:1 e chama o motor 2×.
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve, isAbsolute } from "path";

const A = process.argv.slice(2);
const flag = (k: string, def?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : def; };
const has = (k: string) => A.includes(`--${k}`);
function die(m: string): never { console.error(`✗ ${m}`); process.exit(1); }

const HELP = `
brand-kit — kit de mockups de UMA marca do Visant Labs

  npx tsx --env-file=.env.local scripts/brand-kit.ts --brand <id> --out <dir> [flags]

  --brand <id>       brand id da Visant (obrigatório; veja \`agent-cli brands\`)
  --out <dir>        saída (cria <out>/layouts e <out>/logo)
  --layouts <dir>    criativos de campanha do cliente (metade "layouts")
  --count <n>        mockups por metade (default 10)
  --collection       usa SÓ os mockups da coleção da marca, na ordem curada
                     (data/brand-collections.json). Um lote só; incompatível
                     com --count / --refs / --search.
  --symbol <p|url>   símbolo alta-res p/ a metade "logo" (override do Visant)
  --mono             símbolo é silhueta → recolore nas cores da marca
  --only layouts|logo  roda só uma metade
  --max-crop <f>     0-1: descarta cenas que cortem mais que isso da arte
  --preview          JPEG rápido
  --fresh            ignora _summary.json e recomeça a numeração
  --help             esta ajuda

Coleção: curada na home — selecione a marca no seletor e use o marcador no card
de cada mockup. O que você marcar (e a ordem) é o que sai aqui.
`.trim();

// ── helpers de cor ───────────────────────────────────────────────────────────
type RGB = { r: number; g: number; b: number };
const hexToRgb = (h: string): RGB => { const x = h.replace("#", ""); return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) }; };
const lum = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const chroma = (c: RGB) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

// ── coleção → lista de PSDs ──────────────────────────────────────────────────

/** O mínimo do `SearchDoc` que o plano precisa — evita arrastar o índice inteiro. */
export type CollectionRefDoc = {
  id: string;
  name?: string;
  psdPath?: string;
  psdFileName?: string;
  type?: string;
  photoSceneId?: string;
};

export type CollectionPlan = {
  psdPaths: string[];
  skipped: Array<{ id: string; name?: string; reason: string }>;
};

/**
 * Traduz a coleção curada em caminhos de PSD renderizáveis.
 *
 * A ordem dos `ids` é a curadoria do usuário e sobrevive intacta: quem hidrata
 * (`refsByIds`) já preserva, e aqui a iteração é sobre `ids`, não sobre `docs`.
 *
 * Nada some calado. Todo item que não vira render sai com motivo — um kit com
 * 18 PNGs de uma coleção de 20 tem que dizer quais dois faltaram, senão o
 * usuário só descobre contando arquivo.
 *
 * `psdExists` é injetado porque o teste não tem os 4 mil PSDs no disco.
 */
export function planCollectionRender(
  ids: string[],
  docs: CollectionRefDoc[],
  psdExists: (p: string) => boolean,
): CollectionPlan {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const psdPaths: string[] = [];
  const skipped: CollectionPlan["skipped"] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) { skipped.push({ id, reason: "id repetido na coleção" }); continue; }
    seen.add(id);
    const doc = byId.get(id);
    if (!doc) { skipped.push({ id, reason: "não está mais no catálogo (id sumiu do índice)" }); continue; }
    const label = doc.name || doc.psdFileName;
    if (!doc.psdPath) {
      // Cena de foto não tem PSD: o render dela é outro pipeline, e mandar pro
      // motor de PSD daria "arquivo não encontrado" sem explicar o porquê.
      const reason = doc.type === "photo" || doc.photoSceneId
        ? "cena de foto (sem PSD) — renderize com `photo-agent render --scenes <id>`"
        : "registro sem PSD no catálogo (só thumbnail)";
      skipped.push({ id, name: label, reason });
      continue;
    }
    if (!psdExists(doc.psdPath)) {
      skipped.push({ id, name: label, reason: `PSD fora do disco: ${doc.psdPath}` });
      continue;
    }
    psdPaths.push(doc.psdPath);
  }
  return { psdPaths, skipped };
}

async function fetchToBuffer(src: string): Promise<Buffer> {
  if (/^https?:\/\//.test(src)) { const r = await fetch(src); if (!r.ok) die(`falha baixando ${src}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
  const p = isAbsolute(src) ? src : resolve(src);
  if (!existsSync(p)) die(`símbolo não encontrado: ${p}`);
  return readFileSync(p);
}

/** Roda o brand-mockup-batch.ts como subprocesso (reusa o motor validado).
 * shell:true re-divide por espaços → cita cada arg (caminhos com espaço). */
function runBatch(args: string[], label: string): number {
  const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const cmd = ["npx", "tsx", "--env-file=.env.local", "scripts/brand-mockup-batch.ts", ...args].map(q).join(" ");
  console.log(`\n▶ lote ${label}: ${args.join(" ")}`);
  const r = spawnSync(cmd, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    // Um aviso não bastava: o kit seguia, contava os PNGs ANTIGOS que já estavam
    // na pasta e imprimia "★ Kit … 28 logo" em cima de um lote que morreu no
    // primeiro item. Entrega falsa é pior que entrega faltando — quem lê o
    // resumo não tem como saber que está olhando o resultado da rodada passada.
    console.error(`\n✗ lote ${label} FALHOU (status ${r.status}). Nada foi entregue nesta rodada.`);
    console.error(`  Qualquer arquivo que já esteja na pasta de saída é de uma rodada anterior.`);
    process.exit(r.status ?? 1);
  }
  return 0;
}

async function main() {
  if (has("help") || has("h")) { console.log(HELP); return; }

  const brandId = flag("brand") || die("--brand <visantId> obrigatório (veja `agent-cli brands`)");
  const layoutsArg = flag("layouts");
  const outDir = flag("out") || die("--out <dir> obrigatório");
  const count = parseInt(flag("count", "10")!);
  const only = flag("only");
  const symbolArg = flag("symbol");
  const maxCropArg = flag("max-crop");
  const mono = has("mono");
  const collection = has("collection");

  // Flags que escolhem mockup sozinhas brigam com a coleção. Aceitar as duas
  // renderizaria outra coisa e o usuário só descobriria olhando 20 PNGs.
  if (collection) {
    const conflitos = ["count", "refs", "search"].filter((k) => A.includes(`--${k}`));
    if (conflitos.length) {
      die(`--collection escolhe os mockups pela curadoria; ${conflitos.map((c) => `--${c}`).join(", ")} escolhe(m) por conta própria. Use um OU outro.`);
    }
  }

  // ── coleção: resolve ANTES de falar com o Visant (falha em 1s, não em 10) ──
  let collectionList: string | null = null;
  let collectionSkipped: CollectionPlan["skipped"] = [];
  if (collection) {
    const { getCollection } = await import("../src/lib/collection-store");
    const { refsByIds } = await import("../src/lib/search-index");
    const col = await getCollection(brandId);
    if (!col || !col.items.length) {
      die(
        `a marca ${brandId} não tem coleção curada (data/brand-collections.json).\n` +
        `  Como curar: abra a home, selecione essa marca no seletor e clique no marcador\n` +
        `  (ícone de bookmark) no card de cada mockup que deve entrar no kit. A ordem em\n` +
        `  que você marcar é a ordem em que eles saem daqui.\n` +
        `  Sem --collection, o script escolhe os mockups sozinho por categoria.`,
      );
    }
    const ids = col.items.map((i) => i.id);
    const docs = await refsByIds(ids);
    const plan = planCollectionRender(ids, docs, (p) => existsSync(p));
    collectionSkipped = plan.skipped;
    if (!plan.psdPaths.length) {
      for (const s of plan.skipped) console.error(`  · ${s.name || s.id}: ${s.reason}`);
      die(`nenhum dos ${ids.length} itens da coleção "${col.name}" vira render de PSD (motivos acima).`);
    }
    console.log(`Coleção "${col.name}": ${plan.psdPaths.length}/${ids.length} itens renderizáveis, na ordem curada`);
    // Lista em arquivo, não em CSV de argv: caminho de PSD tem espaço e acento.
    const listDir = resolve(".tmp/brand-kit-collection");
    mkdirSync(listDir, { recursive: true });
    collectionList = join(listDir, `${brandId}.json`);
    writeFileSync(collectionList, JSON.stringify(plan.psdPaths, null, 2));
  }

  const sharp = (await import("sharp")).default;
  const { getBrandGuideline, pickLogo } = await import("../src/lib/visant");

  // 1. Marca via Visant
  console.log(`Marca: buscando ${brandId} no Visant…`);
  const g = await getBrandGuideline(brandId);
  const brandName = g.identity?.name || brandId;
  const colors = (g.colors || []).map((c) => c.hex).filter((h) => /^#?[0-9a-fA-F]{6}$/.test(h)).map((h) => (h.startsWith("#") ? h : `#${h}`));
  if (!colors.length) die("marca sem paleta no Visant");
  const rgbs = colors.map(hexToRgb);
  const dark = colors[rgbs.map(lum).indexOf(Math.min(...rgbs.map(lum)))];
  // accent = maior croma, com desempate por luminância alta (cor "viva" da marca)
  const accent = colors[rgbs.map((c) => chroma(c) + lum(c) * 0.15).indexOf(Math.max(...rgbs.map((c) => chroma(c) + lum(c) * 0.15)))];
  console.log(`✓ ${brandName} — ${colors.length} cores · dark=${dark} accent=${accent}`);

  mkdirSync(outDir, { recursive: true });

  /** Prepara as artes 1:1 do símbolo (logo do Visant ou --symbol) e devolve o dir. */
  const prepareSymbolArt = async (): Promise<string> => {
    // resolve o símbolo: override --symbol, senão logo do Visant (icon→primary)
    let symBuf: Buffer;
    if (symbolArg) { symBuf = await fetchToBuffer(symbolArg); console.log(`Símbolo: ${symbolArg}`); }
    else {
      const logo = pickLogo(g, "icon") || pickLogo(g);
      if (!logo?.url) die("marca sem logo no Visant — passe --symbol <path|url>");
      console.log(`Símbolo: Visant ${logo.variant}${logo.label ? ` (${logo.label})` : ""} ${logo.url}`);
      symBuf = await fetchToBuffer(logo.url);
    }

    const SQ = 1600;
    const artDir = resolve(".tmp/brand-kit-art", brandId);
    mkdirSync(artDir, { recursive: true });
    // Trim do símbolo. A densidade só existe para SVG (rasterização), e ela NÃO
    // pode ser fixa: o logo da Arbolt vem de um `.png` que na verdade é um SVG
    // de 4356pt, e 384 dpi o rasterizava a 23.232px de lado — 540 megapixels,
    // 2x o teto do sharp, e o kit morria com "Input image exceeds pixel limit".
    //
    // A densidade certa é a que entrega ~2x o tamanho final (SQ), com folga para
    // o trim: acima disso é pixel jogado fora, abaixo o símbolo serrilha.
    const densidadeAlvo = async () => {
      try {
        const m = await sharp(symBuf).metadata();
        if (m.format !== "svg" || !m.width) return 384;
        const d = Math.round((72 * SQ * 2) / m.width);
        return Math.max(72, Math.min(384, d));
      } catch {
        return 72; // ilegível sem densidade: o default do sharp já serve
      }
    };
    const trimmed = await sharp(symBuf, { density: await densidadeAlvo() })
      .trim({ threshold: 12 })
      .png()
      .toBuffer();

    const place = async (fg: string | null, bg: string, inner: number, name: string) => {
      const innerPx = Math.round(SQ * inner);
      let icon: Buffer;
      if (fg) {
        // silhueta recolorida: sólido fg recortado pelo alpha do símbolo (dest-in)
        const sil = await sharp(trimmed).resize(innerPx, innerPx, { fit: "inside" }).png().toBuffer();
        const m = await sharp(sil).metadata();
        icon = await sharp({ create: { width: m.width!, height: m.height!, channels: 4, background: hexToRgb(fg) } })
          .composite([{ input: sil, blend: "dest-in" }]).png().toBuffer();
      } else {
        icon = await sharp(trimmed).resize(innerPx, innerPx, { fit: "inside" }).png().toBuffer();
      }
      const im = await sharp(icon).metadata();
      const out = join(artDir, name);
      await sharp({ create: { width: SQ, height: SQ, channels: 4, background: hexToRgb(bg) } })
        .composite([{ input: icon, left: Math.round((SQ - im.width!) / 2), top: Math.round((SQ - im.height!) / 2) }])
        .png().toFile(out);
      console.log(`  ✓ ${name}`);
    };

    if (mono) {
      await place(accent, dark, 0.78, "sym-accent-on-dark.png");
      await place(dark, accent, 0.78, "sym-dark-on-accent.png");
      await place(accent, dark, 0.96, "sym-appicon.png");
    } else {
      // logo como está: contrasta o fundo com a luminância média do símbolo
      await place(null, dark, 0.7, "logo-on-dark.png");
      await place(null, accent, 0.7, "logo-on-accent.png");
    }
    return artDir;
  };

  if (collectionList) {
    // ── lote ÚNICO sobre a coleção ────────────────────────────────────────────
    // Rodar as duas metades aqui repetiria os MESMOS mockups com duas artes —
    // o usuário curou uma lista, não duas. A arte é que escolhe a metade.
    const useLogo = only === "logo" || !layoutsArg;
    const half = useLogo ? "logo" : "layouts";
    const artDir = useLogo ? await prepareSymbolArt() : layoutsArg!;
    console.log(`Arte do lote: ${useLogo ? "logo/símbolo da marca" : layoutsArg}`);
    const a = ["--layouts", artDir, "--psds", collectionList, "--out", join(outDir, half)];
    // Logo NUNCA em `cover`: a coleção curada tem tela de celular (aspecto 0,46)
    // e página de caderno, e a arte do símbolo é quadrada — cobrir corta o logo
    // fora do quadro e sobra fundo chapado. `contain` + fundo amostrado da arte
    // mantém o símbolo inteiro com a cor certa em volta.
    if (useLogo) a.push("--fit", "contain", "--bg", "auto");
    if (maxCropArg) a.push("--max-crop", maxCropArg);
    if (has("preview")) a.push("--preview");
    if (has("fresh")) a.push("--fresh");
    runBatch(a, `coleção→${half}`);
  } else {
    // ── metade LAYOUTS ───────────────────────────────────────────────────────
    if (only !== "logo") {
      if (!layoutsArg) die("--layouts <dir> obrigatório pra metade layouts (ou use --only logo)");
      const a = ["--layouts", layoutsArg, "--out", join(outDir, "layouts"), "--count", String(count)];
      if (maxCropArg) a.push("--max-crop", maxCropArg);
      if (has("preview")) a.push("--preview");
      if (has("fresh")) a.push("--fresh");
      runBatch(a, "layouts");
    }

    // ── metade LOGO (faces ~1:1) ──────────────────────────────────────────────
    if (only !== "layouts") {
      const artDir = await prepareSymbolArt();
      const a = ["--layouts", artDir, "--square", "--out", join(outDir, "logo"), "--count", String(count)];
      if (has("preview")) a.push("--preview");
      if (has("fresh")) a.push("--fresh");
      runBatch(a, "logo");
    }
  }

  // ── kit-summary ───────────────────────────────────────────────────────────
  const read = (p: string) => { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return []; } };
  const summary = {
    brand: { id: brandId, name: brandName, dark, accent, colors },
    layouts: read(join(outDir, "layouts", "_summary.json")),
    logo: read(join(outDir, "logo", "_summary.json")),
    generatedFor: layoutsArg || null,
    ...(collection ? { collection: { skipped: collectionSkipped } } : {}),
  };
  writeFileSync(join(outDir, "kit-summary.json"), JSON.stringify(summary, null, 2));
  const okL = (summary.layouts as Array<{ file?: string }>).filter((r) => r.file).length;
  const okG = (summary.logo as Array<{ file?: string }>).filter((r) => r.file).length;
  console.log(`\n★ Kit ${brandName}: ${okL} layouts + ${okG} logo → ${outDir}`);

  // Fica por último de propósito: é o que sobra na tela quando o lote termina.
  if (collectionSkipped.length) {
    console.log(`\n! ${collectionSkipped.length} item(ns) da coleção ficaram de fora:`);
    for (const s of collectionSkipped) console.log(`  · ${s.name || s.id}: ${s.reason}`);
  }
}

// Só roda como CLI: o teste importa `planCollectionRender` sem disparar o kit.
// Comparação por argv (e não por `import.meta.url`) porque o pacote é CJS —
// sob tsx/vitest o `import.meta` do arquivo nem sempre existe.
if (/brand-kit\.[cm]?ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
