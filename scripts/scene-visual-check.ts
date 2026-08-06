/**
 * scene-visual-check — as telas de operação de cena abrem e DESENHAM?
 *
 *   npx tsx scripts/scene-visual-check.ts --url http://localhost:4100
 *
 * Existe porque a auditoria de 06/08/2026 tirou a matemática de coordenada de
 * dentro do `QuadEditor` para uma lib pura com teste (`lib/quad-math.ts`). Teste
 * de lib prova a conta; não prova a LIGAÇÃO. Um `toCanvas` trocado por engano
 * ainda passa em `tsc`, passa em 400 testes, e entrega um canvas em branco ou o
 * quad desenhado fora da imagem — defeito que só aparece olhando.
 *
 * O que ele checa, e por quê:
 *   - erro de console: hydration, prop faltando, exceção em effect;
 *   - o canvas do editor existe e tem backing store > 0 (canvas com width 0 é o
 *     sintoma exato de fit quebrado, e não lança exceção nenhuma);
 *   - a imagem da cena carregou (`naturalWidth`), senão o fit calcula em cima de
 *     zero e o teste acima passaria por acidente;
 *   - botão sem rótulo acessível.
 *
 * Estas rotas são DESKTOP-ONLY por decisão (06/08/2026), então a medição roda a
 * 1440px. Estouro a 390px não é defeito aqui e não é checado.
 *
 * Sai 1 se qualquer rota falhar.
 */
import puppeteer from "puppeteer";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : "") || "http://localhost:4100";

/** Uma cena real, senão o editor abre vazio e não desenha nada para checar. */
function primeiraCena(): string | null {
  const dir = join(process.cwd(), ".tmp", "photo-scenes");
  if (!existsSync(dir)) return null;
  return readdirSync(dir).find((d) => existsSync(join(dir, d, "analysis.json"))) ?? null;
}

async function main() {
  const cena = primeiraCena();
  console.log(`\n  CENAS (visual) — ${BASE}\n`);
  if (!cena) console.log("  aviso: nenhuma cena em .tmp/photo-scenes — o editor abre vazio\n");

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const falhas: string[] = [];

  const rotas = [
    { nome: "/photo-mockup", url: cena ? `/photo-mockup?scene=${cena}` : "/photo-mockup", esperaCanvas: !!cena },
    { nome: "/calibrate", url: "/calibrate", esperaCanvas: false },
  ];

  try {
    for (const rota of rotas) {
      const page = await browser.newPage();
      const erros: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") erros.push(m.text().slice(0, 160)); });
      page.on("pageerror", (e) => erros.push(`pageerror: ${String(e).slice(0, 160)}`));

      await page.setViewport({ width: 1440, height: 900 });
      // Aquecimento: no dev a primeira visita compila a rota e mede o bundler, não a tela.
      await page.goto(BASE + rota.url, { waitUntil: "networkidle2", timeout: 120_000 });
      await new Promise((r) => setTimeout(r, 800));
      erros.length = 0;
      await page.reload({ waitUntil: "networkidle2", timeout: 120_000 });
      await new Promise((r) => setTimeout(r, 2500));

      /* Cena aberta por link cai na aba de resultado, não na de Cantos — então o
       * editor de quad nem monta e o check passaria sem checar nada. O atalho `C`
       * leva até ele (e de quebra prova que o teclado alcança a ferramenta). */
      if (rota.esperaCanvas) {
        await page.keyboard.press("KeyC");
        await new Promise((r) => setTimeout(r, 1200));
      }

      const m = await page.evaluate(() => {
        const canvases = [...document.querySelectorAll("canvas")];
        const imgs = [...document.querySelectorAll("img")];
        return {
          canvases: canvases.length,
          canvasDesenhavel: canvases.filter((c) => c.width > 0 && c.height > 0).length,
          maiorCanvas: canvases.reduce((a, c) => Math.max(a, c.width), 0),
          imgCarregada: imgs.filter((i) => i.naturalWidth > 0).length,
          semRotuloDetalhe: [...document.querySelectorAll("button")]
            .filter((b) => !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.textContent?.trim())
            .map((b) => b.outerHTML.slice(0, 120)),
        };
      });

      console.log(`  ${rota.nome}`);
      console.log(`    canvas          : ${m.canvasDesenhavel}/${m.canvases} com backing > 0 (maior ${m.maiorCanvas}px)`);
      console.log(`    imagem carregada: ${m.imgCarregada}`);
      console.log(`    botão sem rótulo: ${m.semRotuloDetalhe.length}`);
      m.semRotuloDetalhe.forEach((h) => console.log(`      ${h}`));
      console.log(`    erro de console : ${erros.length}`);
      erros.slice(0, 5).forEach((e) => console.log(`      ${e}`));

      if (erros.length) falhas.push(`${rota.nome}: ${erros.length} erro(s) de console`);
      if (rota.esperaCanvas) {
        if (!m.canvases) falhas.push(`${rota.nome}: nenhum canvas na tela`);
        else if (!m.canvasDesenhavel) falhas.push(`${rota.nome}: canvas existe mas com backing zero (fit quebrado)`);
        if (!m.imgCarregada) falhas.push(`${rota.nome}: a imagem da cena não carregou — o fit calcula sobre zero`);
      }
      if (m.semRotuloDetalhe.length) falhas.push(`${rota.nome}: ${m.semRotuloDetalhe.length} botão(ões) sem rótulo acessível`);

      console.log();
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (falhas.length) {
    console.log("  FALHAS:");
    for (const f of falhas) console.log(`    ${f}`);
    console.log();
    process.exit(1);
  }
  console.log("  tudo ok\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
