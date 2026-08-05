/**
 * Monta (e sobe) o pack do acervo plugável — o que o app de desktop enxerga
 * antes de o usuário plugar uma pasta dele.
 *
 * Três regras que não são detalhe:
 *
 * 1. **Só entra o que está carimbado `boxy`** no `data/psd-license.json`. O
 *    portão é o produto: PSD comprado ou de terceiro não sai daqui, e o default
 *    (`desconhecido`) não distribui. Rode `npm run psd:triage` antes.
 *
 * 2. **Sobe o PSD, não a cena.** Foi medido: o Scene Package é 6x menor mas o
 *    `extractScene` perde a pilha de ajuste (Levels/Curves, grupo FX em
 *    `pass through`) e o render sai lavado — 0 de 6 pixel-perfect em
 *    `bun scripts/scene-fidelity.ts`. Enquanto o engine não fechar essa conta,
 *    fidelidade ganha de tamanho. O manifesto já tem `sceneUrl` reservado pro dia
 *    em que der pra trocar sem mexer no cliente.
 *
 * 3. **Item que não renderiza não é publicado.** Cada PSD passa por um render de
 *    verdade com arte diagnóstica antes de entrar no manifesto. Descobrir aqui
 *    que um mockup está quebrado é barato; descobrir pelo usuário, não.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/publish-pack.ts              # audita e monta o manifesto
 *   npx tsx --env-file=.env.local scripts/publish-pack.ts --limite 10  # só os N primeiros
 *   npx tsx --env-file=.env.local scripts/publish-pack.ts --apply      # sobe pro R2
 *
 * Retomável: o que já passou fica em `.tmp/pack/estado.json` e é pulado.
 * `--fresh` recomeça do zero.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createReadStream } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { createRequire } from "module";
import { execFileSync } from "child_process";
import { scanPsd } from "../src/lib/psd-scan";

/** `canvas` é nativo e só existe no Node do script — import dinâmico via createRequire. */
const requireCanvas = () => createRequire(import.meta.url)("canvas") as { createCanvas: (w: number, h: number) => any };

const arg = (n: string, p = "") => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : p;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const APLICAR = flag("apply");
const FRESH = flag("fresh");
const LIMITE = parseInt(arg("limite", "0"), 10);
/** Filtra alvos por trecho do caminho — para reauditar um item específico. */
const SOMENTE = arg("only");

const PACK_DIR = join(process.cwd(), ".tmp", "pack");
const PREVIEW_DIR = join(PACK_DIR, "previews");
const ESTADO = join(PACK_DIR, "estado.json");
const MANIFESTO = join(PACK_DIR, "catalog.json");

/** Versão do formato do manifesto. O cliente recusa o que não conhece. */
const FORMATO = 1;

interface ItemPack {
  id: string;
  nome: string;
  /** sha256 do PSD: chave de cache no cliente e de idempotência aqui. */
  sha256: string;
  bytes: number;
  largura?: number;
  altura?: number;
  aspecto?: number;
  faces: Array<{ nome: string; smartObject: string; largura?: number; altura?: number }>;
  previewPath: string;
  psdKey: string;
  /** Reservado: quando o `extractScene` for fiel, o cliente troca sem release. */
  sceneUrl?: string;
}

interface Reprovado {
  psd: string;
  motivo: string;
}

interface Estado {
  formato: number;
  itens: Record<string, ItemPack>;
  reprovados: Record<string, Reprovado>;
}

// ------------------------------------------------------------------ licença

/** Os PSDs carimbados `boxy`, pela mesma herança de prefixo da triagem. */
function psdsLiberados(): string[] {
  const licFile = join(process.cwd(), "data", "psd-license.json");
  const scanFile = join(process.cwd(), ".tmp", "psd-triage", "scan.json");
  if (!existsSync(licFile)) {
    console.error("data/psd-license.json não existe. Rode `npm run psd:triage` e carimbe antes.");
    process.exit(1);
  }
  if (!existsSync(scanFile)) {
    console.error("scan do acervo ausente. Rode `npm run psd:triage` (ele grava o cache).");
    process.exit(1);
  }

  const lic = JSON.parse(readFileSync(licFile, "utf8")) as { groups: Record<string, { license: string }> };
  const scan = JSON.parse(readFileSync(scanFile, "utf8")) as { files: Array<{ path: string }> };

  const chaves = Object.entries(lic.groups).map(([k, v]) => [k.toLowerCase(), v.license] as const);
  const licencaDe = (p: string) => {
    const low = p.toLowerCase();
    let melhor = "", lic = "desconhecido";
    for (const [k, l] of chaves) {
      if ((low === k || low.startsWith(k + "/")) && k.length > melhor.length) { melhor = k; lic = l; }
    }
    return lic;
  };

  return scan.files.map((f) => f.path).filter((p) => licencaDe(p) === "boxy" && existsSync(p));
}

// -------------------------------------------------------------- QA de render

/** Arte diagnóstica — mesma ideia do `scene-fidelity`: chapado esconde erro. */
function arteDiagnostica(out: string) {
  if (existsSync(out)) return out;
  mkdirSync(join(PACK_DIR, "qa"), { recursive: true });
  const { createCanvas } = requireCanvas();
  const cv = createCanvas(1600, 1600);
  const g = cv.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 1600, 1600);
  grad.addColorStop(0, "#000"); grad.addColorStop(0.5, "#7f7f7f"); grad.addColorStop(1, "#fff");
  g.fillStyle = grad; g.fillRect(0, 0, 1600, 1600);
  ["#f00", "#0f0", "#00f", "#ff0"].forEach((c, i) => {
    g.fillStyle = c; g.fillRect(i * 400, 560, 400, 480);
  });
  g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 4;
  for (let x = 0; x <= 1600; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1600); g.stroke(); }
  for (let y = 0; y <= 1600; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(1600, y); g.stroke(); }
  writeFileSync(out, cv.toBuffer("image/png"));
  return out;
}

/**
 * Renderiza de verdade e olha o resultado. Render que "não explode" não é
 * render que presta: PNG quase todo de uma cor só é a assinatura do mockup
 * cinza/chapado, e sair disso não é trabalho do usuário.
 */
async function qaRender(psdPath: string, arte: string, outPng: string, faces: string[]): Promise<string> {
  try {
    // Todas as faces EDITÁVEIS, não todos os smart objects.
    //
    // A primeira versão preenchia `meta.smartObjects` inteiro e pintava o
    // cenário de fundo com a arte de teste — a armadilha que o AGENTS.md
    // documenta ("device = face com aspect de tela, não a maior"). Quem separa
    // face de cenário é o `computeFaces` do engine (agrupa por linkId, casa
    // SO_TARGET, descarta Sombra/Luz/Grain e grupo oculto). Sem face detectada,
    // cai no default do `resolveSoTarget` — nunca no "preenche tudo".
    //
    // Cap de 8 é o mesmo do brand-mockup-batch (anti-OOM em mural de pôster).
    const slots = faces.slice(0, 8).flatMap((f) => ["--slot", `${f}::${arte}`]);
    // O 4º posicional FIXA o alvo do slot default. Sem ele o render-cli resolve
    // "Your design" pelo `resolveSoTarget`, que em PSD multi-face às vezes cai
    // num SO de CENÁRIO — e a arte aparecia na parede além da face. Passar a
    // primeira face garante que o default também é face.
    const alvoPadrao = faces[0] ?? "Your design";
    execFileSync("bun", ["scripts/render-cli.ts", psdPath, arte, outPng, alvoPadrao, ...slots], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000,
    });
  } catch (e) {
    return "render falhou: " + String((e as Error).message).split("\n")[0].slice(0, 120);
  }
  if (!existsSync(outPng)) return "render não gerou arquivo";

  const sharp = (await import("sharp")).default;
  const stats = await sharp(outPng).stats();
  // Desvio-padrão perto de zero nos 3 canais = imagem chapada, sem cena.
  const desvio = stats.channels.slice(0, 3).reduce((n, c) => n + c.stdev, 0) / 3;
  if (desvio < 4) return `render chapado (desvio ${desvio.toFixed(1)}) — provável mockup cinza`;

  // A ARTE APARECEU? Nem o desvio-padrão nem "procurar cor saturada" respondem.
  //
  // O desvio aprova cena bonita com a arte faltando. E contar pixel saturado no
  // quadro inteiro é pior ainda: `Metropole 02 - Lambe` tem o pôster BRANCO (a
  // arte não entrou) e pontuou 3,4% porque o GRAFITE da parede tem vermelho e
  // amarelo. Cenário colorido vira falso positivo.
  //
  // O único teste que não se engana é diferencial: renderiza a mesma cena com
  // DUAS artes distintas e vê o que mudou. Pixel que muda é pixel que a arte
  // controla. Não mudou nada ⇒ a face não recebeu a arte, e nenhum cenário
  // colorido salva.
  const mudou = await pixelsQueAArteControla(psdPath, outPng, faces);
  if (mudou < 0.3) {
    return `a arte não apareceu no render (só ${mudou.toFixed(2)}% do quadro muda ao trocar a arte)`;
  }
  return "";
}

/**
 * % do quadro que muda ao trocar a arte. É a medida de "esta face é editável de
 * verdade" — imune a cenário colorido, porque o cenário é idêntico nos dois.
 */
async function pixelsQueAArteControla(psdPath: string, renderA: string, faces: string[]): Promise<number> {
  const sharp = (await import("sharp")).default;
  const arteB = join(PACK_DIR, "qa", "arte-b.png");
  if (!existsSync(arteB)) {
    // Arte B: chapado magenta. Distante de qualquer coisa da arte A em todos os
    // canais, então "mudou" não depende de sorte de cor.
    await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#ff00ff" } })
      .png().toFile(arteB);
  }

  const renderB = join(PACK_DIR, "qa", "b.png");
  try {
    const slots = faces.slice(0, 8).flatMap((f) => ["--slot", `${f}::${arteB}`]);
    execFileSync("bun", ["scripts/render-cli.ts", psdPath, arteB, renderB, ...slots], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000,
    });
  } catch {
    return 0; // não renderizou a segunda vez: trata como "não provou nada"
  }

  const [a, b] = await Promise.all([
    sharp(renderA).resize(480, null, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(renderB).resize(480, null, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.data.length !== b.data.length) return 0;

  let n = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > 24) n++;
  }
  return (n / (a.info.width * a.info.height)) * 100;
}

// ---------------------------------------------------------------------- main

function sha256(p: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(p).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
  });
}

function lerEstado(): Estado {
  if (FRESH || !existsSync(ESTADO)) return { formato: FORMATO, itens: {}, reprovados: {} };
  try {
    const e = JSON.parse(readFileSync(ESTADO, "utf8")) as Estado;
    return e.formato === FORMATO ? e : { formato: FORMATO, itens: {}, reprovados: {} };
  } catch {
    return { formato: FORMATO, itens: {}, reprovados: {} };
  }
}

async function main() {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const estado = lerEstado();
  const arte = arteDiagnostica(join(PACK_DIR, "qa", "arte.png"));

  let alvos = psdsLiberados();
  console.log(`\n  ${alvos.length} PSD(s) carimbados \`boxy\``);
  if (SOMENTE) alvos = alvos.filter((p) => p.toLowerCase().includes(SOMENTE.toLowerCase()));
  if (LIMITE) alvos = alvos.slice(0, LIMITE);

  const sharp = (await import("sharp")).default;
  let novos = 0, pulados = 0;

  for (const [i, psdPath] of alvos.entries()) {
    const nome = basename(psdPath).replace(/\.psd$/i, "");
    const marca = `[${i + 1}/${alvos.length}] ${nome}`;

    if (estado.itens[psdPath] || estado.reprovados[psdPath]) { pulados++; continue; }
    process.stdout.write(`  ${marca} ... `);

    // O scan vem antes do render: é ele que lista as faces a preencher.
    const meta = scanPsd(psdPath);
    if (!meta) {
      estado.reprovados[psdPath] = { psd: psdPath, motivo: "scanPsd não conseguiu ler o arquivo" };
      console.log("REPROVADO — scanPsd não leu");
      writeFileSync(ESTADO, JSON.stringify(estado, null, 2));
      continue;
    }

    const { computeFaces } = await import("@visant/psd-engine");
    // `f.smartObject` (path único do representante), NUNCA `f.name`.
    // `name` é rótulo curto de UI ("Frente", "Arte") e não identifica camada:
    // mandado como slot, o render casou o alvo errado e a arte cobriu a cena
    // inteira enquanto os cartões ficavam com o placeholder. O QA por
    // desvio-padrão aprovou — imagem cheia de contraste, só que errada.
    const facesEditaveis = computeFaces((meta.smartObjects ?? []) as never);

    const outPng = join(PACK_DIR, "qa", `${i}.png`);
    const erro = await qaRender(psdPath, arte, outPng, facesEditaveis.map((f) => f.smartObject));
    if (erro) {
      estado.reprovados[psdPath] = { psd: psdPath, motivo: erro };
      console.log(`REPROVADO — ${erro}`);
      writeFileSync(ESTADO, JSON.stringify(estado, null, 2));
      continue;
    }

    const hash = await sha256(psdPath);
    const id = hash.slice(0, 12);

    // O preview do card é o PRÓPRIO render de QA: o usuário vê o mockup
    // funcionando, não uma foto de catálogo que pode não bater com o resultado.
    const previewRel = `previews/${id}.webp`;
    await sharp(outPng).resize(640, null, { fit: "inside" }).webp({ quality: 80 }).toFile(join(PACK_DIR, previewRel));

    estado.itens[psdPath] = {
      id,
      nome,
      sha256: hash,
      bytes: statSync(psdPath).size,
      largura: meta?.width,
      altura: meta?.height,
      aspecto: meta?.width && meta?.height ? meta.width / meta.height : undefined,
      // O manifesto lista as faces EDITÁVEIS — é o que o app oferece pro
      // usuário escolher. SO de cenário não é opção, é implementação.
      faces: facesEditaveis.map((f) => ({
        nome: f.name,
        // O cliente precisa do path pra pedir render nessa face — o rótulo não serve.
        smartObject: f.smartObject,
        largura: f.innerWidth,
        altura: f.innerHeight,
      })),
      previewPath: previewRel,
      psdKey: `psd/${id}.psd`,
    };
    novos++;
    console.log(`ok (${(statSync(psdPath).size / 1024 ** 2).toFixed(0)} MB, ${estado.itens[psdPath].faces.length} face(s))`);
    writeFileSync(ESTADO, JSON.stringify(estado, null, 2));
  }

  // ------------------------------------------------------------- manifesto
  //
  // Corte por tamanho: a REST API da Cloudflare (e o wrangler) recusam acima de
  // 300 MiB com `413 Payload Too Large`. Acima disso só a API S3 com multipart,
  // que pede Access Key/Secret — credencial que o Bearer token não emite.
  //
  // O corte é ANUNCIADO, nunca silencioso: pack que perde item calado parece
  // completo e ninguém descobre até faltar o mockup.
  const MAX_MB = parseInt(arg("max-mb", "0"), 10);
  const grandes = MAX_MB ? Object.values(estado.itens).filter((it) => it.bytes > MAX_MB * 1024 ** 2) : [];
  const itens = Object.values(estado.itens).filter((it) => !grandes.includes(it));
  if (grandes.length) {
    console.log(`\n  FORA DO PACK por --max-mb ${MAX_MB} (${(grandes.reduce((n, g) => n + g.bytes, 0) / 1024 ** 3).toFixed(1)} GB):`);
    for (const g of grandes) console.log(`    ${(g.bytes / 1024 ** 2).toFixed(0)} MB  ${g.nome}`);
  }
  const reprovados = Object.values(estado.reprovados);
  const manifesto = {
    formato: FORMATO,
    geradoEm: new Date().toISOString(),
    total: itens.length,
    bytesTotais: itens.reduce((n, it) => n + it.bytes, 0),
    itens,
  };
  writeFileSync(MANIFESTO, JSON.stringify(manifesto, null, 2));

  console.log(`\n  aprovados: ${itens.length}   reprovados: ${reprovados.length}   pulados (já feitos): ${pulados}   novos nesta rodada: ${novos}`);
  console.log(`  peso do pack: ${(manifesto.bytesTotais / 1024 ** 3).toFixed(1)} GB`);
  if (reprovados.length) {
    console.log(`\n  REPROVADOS (não entram no pack):`);
    for (const r of reprovados.slice(0, 20)) console.log(`    ${basename(r.psd)} — ${r.motivo}`);
    if (reprovados.length > 20) console.log(`    ... e mais ${reprovados.length - 20}`);
  }
  console.log(`\n  manifesto: ${MANIFESTO}`);

  // ----------------------------------------------------------------- upload
  if (!APLICAR) {
    console.log(`\n  DRY-RUN — nada foi enviado. Rode com --apply para subir pro R2.\n`);
    return;
  }

  // Envio pela REST API da Cloudflare, com Bearer token — o MESMO padrão do
  // `src/app/api/upload/r2/route.ts` do boxy-app, que escolheu essa via
  // justamente "to avoid extra dependencies like AWS SDK". Reaproveitar aqui
  // significa zero dependência nova e as credenciais que já existem.
  //
  // Cabe? Sim, e foi conferido nos limites publicados do R2:
  //   - upload de UMA requisição vai até ~5 GiB; o maior PSD do pack tem 675 MB;
  //   - a REST é limitada a 1.200 requisições / 5 min, e o pack são 213
  //     (106 PSD + 106 prévias + manifesto).
  // Se o pack crescer pra milhares de itens, aí sim a API S3 passa a ser a certa
  // — a própria Cloudflare recomenda ela para alto volume.
  const accountId = process.env.CLOUDFARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFARE_API_KEY || process.env.R2_API_TOKEN;
  const bucket = process.env.CLOUDFARE_BUCKET_NAME || process.env.R2_BUCKET;
  const publicUrl = process.env.CLOUDFARE_PUBLIC_URL || process.env.R2_PUBLIC_URL;

  if (!accountId || !apiKey || !bucket) {
    console.error(
      `\n  Faltam credenciais no .env.local:\n` +
        `    CLOUDFARE_ACCOUNT_ID, CLOUDFARE_API_KEY, CLOUDFARE_BUCKET_NAME [, CLOUDFARE_PUBLIC_URL]\n` +
        `  (mesmos nomes do boxy-app — dá pra copiar o bloco de lá)\n` +
        `  O manifesto acima já está pronto; só o envio ficou pendente.\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Prefixo próprio: o bucket `boxy` também serve os assets do boxy.app, e
  // despejar 106 PSDs na raiz dele mistura duas coisas que têm ciclos de vida
  // diferentes. Tudo do pack mora sob `boxy-pack/`.
  const PREFIXO = arg("prefixo", "boxy-pack/");

  const caminhoPorId = new Map(Object.entries(estado.itens).map(([caminho, it]) => [it.id, caminho]));

  const subir = async (key: string, corpo: Buffer, tipo: string) => {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(PREFIXO + key)}`,
      { method: "PUT", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": tipo }, body: corpo as never },
    );
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  };

  // Inventário do que JÁ está no bucket, com tamanho. Sem isto, cada re-rodada
  // resubia 12,5 GB para reenviar o que já estava idêntico lá.
  const jaLa = new Map<string, number>();
  let cursor: string | null = null;
  do {
    const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`);
    u.searchParams.set("per_page", "1000");
    if (cursor) u.searchParams.set("cursor", cursor);
    const j = (await (await fetch(u, { headers: { Authorization: `Bearer ${apiKey}` } })).json()) as {
      success: boolean;
      result: Array<{ key: string; size: number }>;
      result_info?: { cursor?: string };
    };
    if (!j.success) break;
    for (const o of j.result) jaLa.set(o.key, o.size);
    cursor = j.result_info?.cursor || null;
  } while (cursor);
  console.log(`  ${jaLa.size} objeto(s) já no bucket — só sobe o que falta ou mudou de tamanho\n`);

  const precisa = (key: string, bytes: number) => jaLa.get(PREFIXO + key) !== bytes;

  let enviados = 0, jaEstavam = 0;
  const falhas: string[] = [];
  for (const [i, it] of itens.entries()) {
    const previewBytes = statSync(join(PACK_DIR, it.previewPath)).size;
    if (!precisa(it.psdKey, it.bytes) && !precisa(`previews/${it.id}.webp`, previewBytes)) {
      jaEstavam++;
      continue;
    }
    process.stdout.write(`  [${i + 1}/${itens.length}] ${it.nome} (${(it.bytes / 1024 ** 2).toFixed(0)} MB) ... `);
    try {
      if (precisa(it.psdKey, it.bytes)) {
        await subir(it.psdKey, readFileSync(caminhoPorId.get(it.id)!), "image/vnd.adobe.photoshop");
      }
      if (precisa(`previews/${it.id}.webp`, previewBytes)) {
        await subir(`previews/${it.id}.webp`, readFileSync(join(PACK_DIR, it.previewPath)), "image/webp");
      }
      enviados++;
      console.log("enviado");
    } catch (e) {
      falhas.push(`${it.nome}: ${(e as Error).message}`);
      console.log(`FALHOU — ${(e as Error).message}`);
    }
  }
  if (jaEstavam) console.log(`  ${jaEstavam} item(ns) já estavam no bucket, intactos.`);

  // O manifesto sobe POR ÚLTIMO, e só se tudo foi. Ele é o que o cliente lê:
  // publicá-lo apontando pra objeto que não subiu é entregar card quebrado.
  if (falhas.length) {
    console.error(`\n  ${falhas.length} item(ns) falharam — manifesto NÃO publicado.`);
    for (const f of falhas.slice(0, 10)) console.error(`    ${f}`);
    console.error(`  Rode de novo: o que subiu não sobe de novo à toa (mesma key, mesmo conteúdo).\n`);
    process.exitCode = 1;
    return;
  }

  await subir("catalog.json", Buffer.from(JSON.stringify(manifesto)), "application/json");
  console.log(`\n  pack publicado: ${enviados} itens + catalog.json`);
  // O PREFIXO faz parte da chave, então faz parte da URL — sem ele a linha
  // imprimia um endereço que dá 404.
  if (publicUrl) console.log(`  manifesto em: ${publicUrl.replace(/\/$/, "")}/${PREFIXO}catalog.json\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
