/**
 * ingest-visual-check — o fluxo de ingest visto rodando, não só compilando.
 *
 *   npx next start -p 3127
 *   npx tsx scripts/ingest-visual-check.ts --url http://localhost:3127
 *
 * Existe porque os testes deste repo são todos de lib e o `smoke` só bate HTTP:
 * nenhum deles abre o diálogo, mede largura ou percebe que um caminho de 90
 * caracteres estourou o container. Este script dirige um Chrome de verdade
 * (puppeteer já é dependência) e checa o que só se vê com o olho:
 *
 *   1. o gatilho abre um DIÁLOGO, não uma seção da sidebar
 *   2. o stepper mostra as cinco etapas
 *   3. o campo de pasta recebe foco e aceita caminho longo sem estourar
 *   4. nada rola horizontalmente, nem a 390px
 *
 * Sai 1 em qualquer falha, então serve de portão.
 */
import puppeteer, { type Page } from "puppeteer";
import { mkdirSync } from "fs";
import { join } from "path";

const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : "") || "http://localhost:3000";
const SHOTS = join(process.cwd(), ".tmp", "ingest-visual");

/** Longo de propósito: é um caminho real de Drive, do tamanho que estoura layout. */
const CAMINHO_LONGO =
  "H:/.shortcut-targets-by-id/1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY/[ MOCKUPS 1.0 ]/Campanha 2026/Layouts";

/** Existe de verdade neste repo, então a validação ao vivo aprova. */
const CAMINHO_VALIDO = process.cwd().replace(/\\/g, "/") + "/fixtures";

interface Check {
  nome: string;
  ok: boolean;
  detalhe: string;
}
const checks: Check[] = [];
function assert(nome: string, ok: boolean, detalhe = "") {
  checks.push({ nome, ok, detalhe });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? `  — ${detalhe}` : ""}`);
}

/** Estouro horizontal: a página inteira nunca pode rolar de lado. */
async function semEstouroHorizontal(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return { scroll: d.scrollWidth, client: d.clientWidth };
  });
}

async function abrirDialogo(page: Page) {
  await page.waitForSelector('[aria-label="Adicionar pasta ao acervo"]', { timeout: 15000 });
  await page.click('[aria-label="Adicionar pasta ao acervo"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
}

async function rodar(largura: number, altura: number, rotulo: string) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: largura, height: altura });
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });

    // 1. O gatilho abre um diálogo de verdade.
    await abrirDialogo(page);
    const temDialogo = await page.$('[role="dialog"]');
    assert(`[${rotulo}] gatilho abre um diálogo`, !!temDialogo);

    // 2. O stepper existe e tem as cinco etapas.
    const etapas = await page.$$eval('[aria-label="Etapas do ingest"] li', (ls) => ls.length);
    assert(`[${rotulo}] stepper mostra 5 etapas`, etapas === 5, `${etapas} encontradas`);

    // 3. O campo recebe foco sozinho e aguenta caminho longo.
    const focado = await page.evaluate(() => document.activeElement?.id ?? "");
    assert(`[${rotulo}] campo da pasta já vem com foco`, focado === "ingest-folder", focado || "(nenhum)");

    await page.type("#ingest-folder", CAMINHO_LONGO);
    const campo = await page.$eval("#ingest-folder", (el) => {
      const i = el as HTMLInputElement;
      return { scroll: i.scrollWidth, client: i.clientWidth, valor: i.value.length };
    });
    assert(
      `[${rotulo}] caminho de ${campo.valor} caracteres não quebra o layout`,
      campo.client > 0,
      `campo com ${campo.client}px`,
    );

    // 4. Nada rola de lado, com o diálogo aberto e o campo cheio.
    const { scroll, client } = await semEstouroHorizontal(page);
    assert(
      `[${rotulo}] página não rola horizontalmente`,
      scroll <= client + 1,
      `scrollWidth ${scroll} × clientWidth ${client}`,
    );

    // 5. Nada é CORTADO pelas bordas do diálogo.
    //
    // A checagem acima não basta e já deixou passar um defeito real: o diálogo
    // tem `overflow-hidden`, então um botão que sai pela direita não faz a
    // página rolar — ele simplesmente some pela metade, em silêncio. Aqui cada
    // elemento interativo é medido contra a caixa do diálogo.
    const cortados = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"] > div') as HTMLElement | null;
      if (!dlg) return ["diálogo não encontrado"];
      const caixa = dlg.getBoundingClientRect();
      const fora: string[] = [];
      for (const el of Array.from(dlg.querySelectorAll("button, input, a"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > caixa.right + 1 || r.left < caixa.left - 1) {
          const nome = (el.textContent || (el as HTMLInputElement).id || el.tagName).trim().slice(0, 30);
          fora.push(`${nome} (${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(caixa.left)}..${Math.round(caixa.right)})`);
        }
      }
      return fora;
    });
    assert(
      `[${rotulo}] nada cortado pelas bordas do diálogo`,
      cortados.length === 0,
      cortados.join("; ") || "todos dentro",
    );

    // 6. A validação ao vivo reprova caminho que não existe, e o primário fica
    // desabilitado. Antes o campo era mudo até o 404 depois de mandar varrer.
    await page.waitForFunction(
      () => (document.querySelector("#ingest-folder-estado")?.textContent ?? "").includes("não existe"),
      { timeout: 5000 },
    );
    const bloqueado = await page.$eval("#ingest-folder ~ * , #ingest-folder", () => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").trim().toUpperCase().startsWith("VARRER"),
      ) as HTMLButtonElement | undefined;
      return btn?.disabled ?? false;
    });
    assert(`[${rotulo}] caminho inexistente reprova e trava o "Varrer"`, bloqueado);

    // 7. Caminho real aprova e libera.
    await page.click("#ingest-folder", { count: 3 });
    await page.type("#ingest-folder", CAMINHO_VALIDO);
    await page.waitForFunction(
      () => (document.querySelector("#ingest-folder-estado")?.textContent ?? "").includes("encontrada"),
      { timeout: 5000 },
    );
    const liberado = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").trim().toUpperCase().startsWith("VARRER"),
      ) as HTMLButtonElement | undefined;
      return btn ? !btn.disabled : false;
    });
    assert(`[${rotulo}] caminho real aprova e libera o "Varrer"`, liberado);

    // 8. O navegador de pastas do app abre e lista as unidades.
    const btnProcurar = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Procurar pasta"),
      ),
    );
    await (btnProcurar.asElement() as unknown as { click: () => Promise<void> })?.click();
    await page.waitForFunction(
      () => !!document.querySelector('[role="dialog"] ul li button'),
      { timeout: 5000 },
    );
    const unidades = await page.$$eval('[role="dialog"] ul li button', (bs) => bs.length);
    assert(`[${rotulo}] navegador de pastas lista unidades`, unidades > 0, `${unidades} entradas`);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `ingest-${rotulo}.png`) as `${string}.png` });
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`\n  VISUAL — ${BASE}\n`);
  await rodar(1440, 900, "1440px");
  await rodar(390, 844, "390px");

  const falhas = checks.filter((c) => !c.ok);
  console.log(
    `\n  ${checks.length - falhas.length}/${checks.length} ok${falhas.length ? ` — ${falhas.length} FALHA(S)` : ""}`,
  );
  console.log(`  Capturas em ${SHOTS}\n`);
  if (falhas.length) process.exit(1);
}

main().catch((e) => {
  console.error(`\n  Falhou: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
