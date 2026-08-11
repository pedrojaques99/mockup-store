/**
 * A cor sólida chega no render? Prova, não opinião.
 *
 * O defeito que este portão existe para pegar é MUDO: a UI mostra o seletor, o
 * usuário escolhe, o render responde 200 — e sai a cor velha. Aconteceu na
 * primeira tentativa, e o culpado era um render-server ZUMBI de uma sessão
 * anterior segurando a 4200 com o código antigo (a mesma armadilha que o
 * `check:offline` já documenta: no Windows, `kill` não mata; é `taskkill /T`).
 *
 * Medir "a cor aparece" procurando o pixel rosa na imagem não serve — é o mesmo
 * erro que o `pack:publish` já pagou com a arte: cenário colorido é
 * indistinguível de cor aplicada. O que serve é o DIFERENCIAL: dois renders da
 * mesma cena, só o campo `colors` muda, e conta-se quanto do quadro mudou. O
 * cenário é idêntico nos dois e se cancela.
 *
 * Uso:
 *   npm run check:colors -- --url http://localhost:4100
 *   npm run check:colors -- --psd "Z:/.../arquivo.psd"
 *
 * Pré-requisitos: app de pé e render-server na 4200 (`npm run render`).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const arg = (nome: string, padrao = "") => {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const URL_BASE = arg("url", "http://localhost:4100");
const PSD = arg("psd", "Z:/BOXY/Produtos/Coffee Cups/Coffee Paper Cups.psd");
const SAIDA = ".tmp/check-colors";

/** Pixel que muda entre os dois renders é pixel que a cor controla. */
const MINIMO_PCT = 0.3;

let falhou = false;
const ok = (nome: string, passou: boolean, detalhe = "") => {
  console.log(`  ${passou ? "OK  " : "FALHA"}  ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!passou) falhou = true;
};

async function main() {
  console.log(`\n  Cor sólida no render — ${PSD.split(/[/\\]/).pop()}\n`);

  if (!existsSync(PSD)) {
    ok("PSD de teste existe", false, PSD);
    return;
  }
  mkdirSync(SAIDA, { recursive: true });

  // 1. A API lista as camadas de cor?
  const nome = PSD.split(/[/\\]/).pop()!.replace(/\.psd$/i, "");
  let slots: Array<{ path: string; name: string; hex: string }> = [];
  try {
    const r = await fetch(`${URL_BASE}/api/psd-info?name=${encodeURIComponent(nome)}`);
    const j = (await r.json()) as { colorSlots?: typeof slots };
    slots = j.colorSlots ?? [];
    ok("/api/psd-info lista camadas de cor", slots.length > 0, `${slots.length} camada(s)`);
  } catch (e) {
    ok("/api/psd-info responde", false, String(e));
  }
  if (!slots.length) return;

  // 2. Dois renders, só a cor muda.
  const arte = gerarArte();
  const render = async (colors: Record<string, string>, saida: string) => {
    const res = await fetch(`${URL_BASE}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ psdPath: PSD, arts: [{ artBase64: arte }], colors, preview: true }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(saida, buf);
    return saida;
  };

  const trocadas: Record<string, string> = {};
  for (const [i, s] of slots.slice(0, 3).entries()) {
    trocadas[s.path] = ["#ff0055", "#00ccff", "#bfff38"][i] ?? "#ff0055";
  }

  try {
    const a = await render({}, join(SAIDA, "original.png"));
    const b = await render(trocadas, join(SAIDA, "trocada.png"));
    const pct = await diferenca(a, b);
    ok(
      `trocar ${Object.keys(trocadas).length} cor(es) muda o render`,
      pct > MINIMO_PCT,
      `${pct.toFixed(2)}% dos pixels (mínimo ${MINIMO_PCT}%)`
    );

    // 3. Camada que não existe não pode derrubar o render nem mudar a imagem.
    const c = await render({ "Camada Que Nao Existe": "#ff0055" }, join(SAIDA, "inexistente.png"));
    const pctInv = await diferenca(a, c);
    ok("camada inexistente é ignorada sem quebrar", pctInv <= MINIMO_PCT, `${pctInv.toFixed(2)}% dos pixels`);
  } catch (e) {
    ok("render responde", false, String(e instanceof Error ? e.message : e));
  }

  console.log(`\n  Imagens em ${SAIDA}/\n`);
}

function gerarArte(): string {
  // Arte chapada esconde erro de blend; um quadriculado não.
  const { createCanvas } = require("canvas");
  const cv = createCanvas(1024, 1024);
  const g = cv.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 1024, 1024);
  g.fillStyle = "#111111";
  for (let y = 0; y < 1024; y += 128)
    for (let x = 0; x < 1024; x += 128) if (((x + y) / 128) % 2 === 0) g.fillRect(x, y, 128, 128);
  return cv.toBuffer("image/png").toString("base64");
}

async function diferenca(a: string, b: string): Promise<number> {
  const { createCanvas, loadImage } = require("canvas");
  const [ia, ib] = await Promise.all([loadImage(a), loadImage(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return 100;
  const ca = createCanvas(ia.width, ia.height);
  ca.getContext("2d").drawImage(ia, 0, 0);
  const cb = createCanvas(ib.width, ib.height);
  cb.getContext("2d").drawImage(ib, 0, 0);
  const da = ca.getContext("2d").getImageData(0, 0, ia.width, ia.height).data;
  const db = cb.getContext("2d").getImageData(0, 0, ib.width, ib.height).data;
  let mudou = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (
      Math.abs(da[i] - db[i]) > 2 ||
      Math.abs(da[i + 1] - db[i + 1]) > 2 ||
      Math.abs(da[i + 2] - db[i + 2]) > 2
    )
      mudou++;
  }
  return (100 * mudou) / (da.length / 4);
}

main()
  .then(() => process.exit(falhou ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
