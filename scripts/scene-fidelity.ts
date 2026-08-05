/**
 * A cena extraída é pixel-perfect em relação ao PSD? Prova, não opinião.
 *
 * O pack do app de desktop pode subir o Scene Package em vez do PSD cru (4x
 * menor, e o engine renderiza sem precisar do arquivo). Só que isso só vale se o
 * resultado for IDÊNTICO — "quase igual" num mockup é arte com blend errado, e o
 * usuário não tem como saber que o certo era outro.
 *
 * Aqui as duas pipelines renderizam a MESMA arte no MESMO PSD e a diferença é
 * medida pixel a pixel:
 *
 *   A) PSD    → composePsd (a mesma do render-server / produção hoje)
 *   B) Cena   → extractScene → renderScene (o que iria pro R2)
 *
 * A extração já avisa quando não sabe mapear um blend ("pass through" apareceu no
 * primeiro PSD testado). Este script existe para responder o que o aviso não
 * responde: isso muda algum pixel, e quantos?
 *
 * Uso (sempre bun — o engine faz top-level await e usa canvas nativo):
 *   bun scripts/scene-fidelity.ts --psd "<arquivo.psd>"
 *   bun scripts/scene-fidelity.ts --amostra 8          # varre os PSDs `boxy` da triagem
 *   bun scripts/scene-fidelity.ts --amostra 8 --tolerancia 2
 *
 * Saída: .tmp/fidelity/<nome>/{psd,cena,diff}.png + veredito por item e placar.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, readdirSync } from "fs";
import { join, basename, dirname } from "path";
import { execFileSync } from "child_process";

const arg = (nome: string, padrao = "") => {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

/**
 * Diferença de 1/255 num canal é ruído de arredondamento entre dois caminhos de
 * composição — não é "blend errado". O default aceita isso e nada além.
 */
const TOLERANCIA = parseInt(arg("tolerancia", "1"), 10);
const SAIDA = join(process.cwd(), ".tmp", "fidelity");

// --------------------------------------------------------------- arte de teste

/**
 * Arte diagnóstica: gradiente + grade + chapados saturados.
 *
 * Arte chapada esconde erro — um blend multiply errado sobre branco continua
 * branco. O gradiente denuncia curva/level fora do lugar, a grade denuncia
 * deslocamento de warp, e os chapados denunciam blend trocado.
 */
async function arteDiagnostica(w: number, h: number, out: string) {
  const { createCanvas } = await import("canvas");
  const cv = createCanvas(w, h);
  const g = cv.getContext("2d");

  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#000000");
  grad.addColorStop(0.5, "#7f7f7f");
  grad.addColorStop(1, "#ffffff");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const cores = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];
  const cw = w / cores.length;
  cores.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(i * cw, h * 0.35, cw, h * 0.3);
  });

  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = Math.max(1, Math.round(w / 400));
  const passo = w / 16;
  for (let x = 0; x <= w; x += passo) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  for (let y = 0; y <= h; y += passo) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }

  writeFileSync(out, cv.toBuffer("image/png"));
}

// ------------------------------------------------------------------- diferença

interface Veredito {
  psd: string;
  ok: boolean;
  motivo: string;
  maxCanal: number;
  mediaCanal: number;
  pctAcimaTol: number;
  avisosExtracao: string[];
  tamanhoPsdMb: number;
  tamanhoCenaMb: number;
}

async function comparar(aPath: string, bPath: string, diffPath: string) {
  const { createCanvas, loadImage } = await import("canvas");
  const [ia, ib] = await Promise.all([loadImage(aPath), loadImage(bPath)]);

  if (ia.width !== ib.width || ia.height !== ib.height) {
    return {
      maxCanal: 255,
      mediaCanal: 255,
      pctAcimaTol: 100,
      dimensoesDiferentes: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`,
    };
  }

  const w = ia.width, h = ia.height;
  const ca = createCanvas(w, h), cb = createCanvas(w, h), cd = createCanvas(w, h);
  ca.getContext("2d").drawImage(ia, 0, 0);
  cb.getContext("2d").drawImage(ib, 0, 0);
  const da = ca.getContext("2d").getImageData(0, 0, w, h).data;
  const db = cb.getContext("2d").getImageData(0, 0, w, h).data;
  const ctxD = cd.getContext("2d");
  const saida = ctxD.createImageData(w, h);

  let max = 0, soma = 0, acima = 0;
  const totalPx = w * h;

  for (let i = 0; i < da.length; i += 4) {
    let pior = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(da[i + c] - db[i + c]);
      if (d > pior) pior = d;
      soma += d;
    }
    if (pior > max) max = pior;
    if (pior > TOLERANCIA) acima++;

    // Heatmap: preto = igual, vermelho = divergente. Amplificado 8x porque
    // diferença real de blend costuma ser sutil e invisível em escala 1:1.
    const v = Math.min(255, pior * 8);
    saida.data[i] = v;
    saida.data[i + 1] = v > 0 ? Math.max(0, 64 - v) : 0;
    saida.data[i + 2] = 0;
    saida.data[i + 3] = 255;
  }

  ctxD.putImageData(saida, 0, 0);
  mkdirSync(dirname(diffPath), { recursive: true });
  writeFileSync(diffPath, cd.toBuffer("image/png"));

  return {
    maxCanal: max,
    mediaCanal: soma / (totalPx * 3),
    pctAcimaTol: (acima / totalPx) * 100,
    dimensoesDiferentes: "",
  };
}

// ----------------------------------------------------------------- um PSD só

const mb = (p: string) => {
  try { return statSync(p).size / 1024 ** 2; } catch { return 0; }
};

function tamanhoPasta(dir: string): number {
  let n = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    n += s.isDirectory() ? tamanhoPasta(p) : s.size;
  }
  return n / 1024 ** 2;
}

async function avaliar(psdPath: string): Promise<Veredito> {
  const nome = basename(psdPath).replace(/\.psd$/i, "").replace(/[^\w-]+/g, "_");
  const dir = join(SAIDA, nome);
  mkdirSync(dir, { recursive: true });

  const v: Veredito = {
    psd: psdPath, ok: false, motivo: "", maxCanal: -1, mediaCanal: -1,
    pctAcimaTol: -1, avisosExtracao: [], tamanhoPsdMb: mb(psdPath), tamanhoCenaMb: 0,
  };

  const arte = join(dir, "arte.png");
  await arteDiagnostica(2048, 2048, arte);

  const bun = (script: string, args: string[]) =>
    execFileSync("bun", [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });

  // A extração vem PRIMEIRO porque ela é quem lista as faces. Sem isso o lado do
  // PSD preenchia só a face default do `resolveSoTarget` enquanto a cena
  // preenchia todas — e a comparação media a diferença do meu próprio harness,
  // não a das duas pipelines.
  const cenasDir = join(dir, "cena");
  rmSync(cenasDir, { recursive: true, force: true });
  let sceneId = "";
  let faces: Array<{ key: string; name: string }> = [];
  try {
    const log = bun("scripts/extract-scene.ts", ["--psd", psdPath, "--out", cenasDir]);
    v.avisosExtracao = [...log.matchAll(/⚠\s*(.+)/g)].map((m) => m[1].trim());
    sceneId = (log.match(/Scene ID:\s*(\w+)/) ?? [])[1] ?? "";
    if (!sceneId) throw new Error("extract-scene não devolveu Scene ID");
    v.tamanhoCenaMb = tamanhoPasta(join(cenasDir, sceneId));
    const doc = JSON.parse(readFileSync(join(cenasDir, sceneId, "scene.json"), "utf8"));
    faces = (doc.doc?.faces ?? []).map((f: { key: string; name: string }) => ({ key: f.key, name: f.name }));
  } catch (e) {
    v.motivo = "extração da cena falhou: " + String((e as Error).message).split("\n")[0];
    return v;
  }

  // A) PSD → composePsd (a produção de hoje), com TODAS as faces preenchidas.
  const outPsd = join(dir, "psd.png");
  try {
    const slots = faces.flatMap((f) => ["--slot", `${f.name}::${arte}`]);
    bun("scripts/render-cli.ts", [psdPath, arte, outPsd, ...slots]);
  } catch (e) {
    v.motivo = "render pelo PSD falhou: " + String((e as Error).message).split("\n")[0];
    return v;
  }

  const outCena = join(dir, "cena.png");
  try {
    bun("scripts/render-scene.ts", ["--scene", sceneId, "--art", arte, "--out", outCena, "--scenes", cenasDir]);
  } catch (e) {
    v.motivo = "render pela cena falhou: " + String((e as Error).message).split("\n")[0];
    return v;
  }

  const d = await comparar(outPsd, outCena, join(dir, "diff.png"));
  v.maxCanal = d.maxCanal;
  v.mediaCanal = d.mediaCanal;
  v.pctAcimaTol = d.pctAcimaTol;

  if (d.dimensoesDiferentes) {
    v.motivo = `dimensões diferentes: ${d.dimensoesDiferentes}`;
  } else if (d.maxCanal <= TOLERANCIA) {
    v.ok = true;
    v.motivo = "idêntico dentro da tolerância";
  } else {
    v.motivo = `divergência de até ${d.maxCanal}/255 em ${d.pctAcimaTol.toFixed(2)}% dos pixels`;
  }
  return v;
}

// ---------------------------------------------------------------------- main

function psdsBoxy(limite: number): string[] {
  const licFile = join(process.cwd(), "data", "psd-license.json");
  const scanFile = join(process.cwd(), ".tmp", "psd-triage", "scan.json");
  if (!existsSync(licFile) || !existsSync(scanFile)) {
    console.error("Rode `npm run psd:triage` antes: preciso da licença e do scan.");
    process.exit(1);
  }
  const lic = JSON.parse(readFileSync(licFile, "utf8")) as {
    groups: Record<string, { license: string }>;
  };
  const scan = JSON.parse(readFileSync(scanFile, "utf8")) as { files: Array<{ path: string; sizeBytes: number }> };

  const boxy = Object.entries(lic.groups).filter(([, v]) => v.license === "boxy").map(([k]) => k.toLowerCase());
  const naoBoxy = Object.entries(lic.groups).filter(([, v]) => v.license !== "boxy").map(([k]) => k.toLowerCase());
  const maisLongo = (p: string, chaves: string[]) =>
    chaves.filter((k) => p === k || p.startsWith(k + "/")).sort((a, b) => b.length - a.length)[0] ?? "";

  const eBoxy = (p: string) => {
    const low = p.toLowerCase();
    const b = maisLongo(low, boxy);
    const n = maisLongo(low, naoBoxy);
    return b.length > n.length;
  };

  // Amostra espalhada por tamanho: mockup pequeno e mural gigante quebram
  // diferente, e pegar só os primeiros da lista testaria sempre a mesma coisa.
  const todos = scan.files.filter((f) => eBoxy(f.path)).sort((a, b) => a.sizeBytes - b.sizeBytes);
  if (todos.length <= limite) return todos.map((f) => f.path);
  const passo = todos.length / limite;
  return Array.from({ length: limite }, (_, i) => todos[Math.floor(i * passo)].path);
}

async function main() {
  const um = arg("psd");
  const alvos = um ? [um] : psdsBoxy(parseInt(arg("amostra", "6"), 10));

  console.log(`\n  Fidelidade cena vs PSD — ${alvos.length} arquivo(s), tolerância ${TOLERANCIA}/255\n`);

  const vereditos: Veredito[] = [];
  for (const [i, p] of alvos.entries()) {
    process.stdout.write(`  [${i + 1}/${alvos.length}] ${basename(p)} ... `);
    const v = await avaliar(p);
    vereditos.push(v);
    console.log(v.ok ? `OK (max ${v.maxCanal}/255)` : `FALHOU — ${v.motivo}`);
    if (v.avisosExtracao.length) for (const a of v.avisosExtracao) console.log(`        aviso: ${a}`);
  }

  const ok = vereditos.filter((v) => v.ok);
  const psdMb = vereditos.reduce((n, v) => n + v.tamanhoPsdMb, 0);
  const cenaMb = vereditos.reduce((n, v) => n + v.tamanhoCenaMb, 0);

  console.log(`\n  ${ok.length}/${vereditos.length} pixel-perfect dentro de ${TOLERANCIA}/255`);
  if (cenaMb) console.log(`  peso: ${psdMb.toFixed(0)} MB de PSD -> ${cenaMb.toFixed(0)} MB de cena (${(psdMb / cenaMb).toFixed(1)}x menor)`);
  const ruins = vereditos.filter((v) => !v.ok);
  if (ruins.length) {
    console.log(`\n  NAO passaram:`);
    for (const v of ruins) console.log(`    ${basename(v.psd)} — ${v.motivo}`);
    console.log(`\n  Olhe o heatmap: .tmp/fidelity/<nome>/diff.png (preto = igual, vermelho = divergente)`);
  }
  console.log("");

  writeFileSync(join(SAIDA, "resultado.json"), JSON.stringify(vereditos, null, 2));
  if (ruins.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
