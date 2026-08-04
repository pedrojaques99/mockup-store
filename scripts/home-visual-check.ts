/**
 * home-visual-check — a home vista rodando, não só compilando.
 *
 *   npm run dev            (ou npx next start -p 3127)
 *   npx tsx scripts/home-visual-check.ts --url http://localhost:3000
 *
 * Irmão do `ingest-visual-check`, mirando o grid do acervo. Existe porque três
 * classes de defeito desta tela são INVISÍVEIS para tsc/lint/vitest e já
 * passaram batido:
 *
 *   1. **Contraste**: a contagem de cada tag era `text-neutral-800` (#262626)
 *      sobre `bg-neutral-900` (#171717) — ~1.3:1. O número existia no DOM e não
 *      na tela. Classe é string; nada tipa uma cor.
 *   2. **Orçamento de cromo**: quantos px verticais até o PRIMEIRO card. Numa
 *      superfície de trabalho isso é orçamento, e ninguém mede por engenharia.
 *   3. **Estouro horizontal** a 390px, que a raiz `overflow-hidden` esconde:
 *      o elemento não faz a página rolar, ele só some pela borda.
 *
 * Mede contra o elemento, não contra o documento — foi assim que o portão do
 * ingest deixou passar um botão cortado. Sai 1 em qualquer falha: serve de portão.
 */
import puppeteer, { type Page } from "puppeteer";
import { mkdirSync } from "fs";
import { join } from "path";

const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : "") || "http://localhost:3000";
const SHOTS = join(process.cwd(), ".tmp", "home-visual");

/** Piso de contraste para texto pequeno. WCAG AA pede 4.5; 3.0 é o mínimo que
 *  ainda se lê e é o que este repo aceita para metadado secundário. Abaixo disso
 *  não é "discreto", é ausente. */
const CONTRASTE_MIN = 3.0;

/** Teto de cromo: px do topo do viewport até o primeiro card do grid. */
const CROMO_MAX = 260;

interface Check { nome: string; ok: boolean; detalhe: string }
const checks: Check[] = [];
function assert(nome: string, ok: boolean, detalhe = "") {
  checks.push({ nome, ok, detalhe });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? `  — ${detalhe}` : ""}`);
}

/**
 * Contraste de TODO texto visível contra o fundo que realmente aparece atrás
 * dele. `getComputedStyle().backgroundColor` do próprio nó quase sempre é
 * `rgba(0,0,0,0)`, então é preciso subir a árvore até achar um fundo opaco —
 * era exatamente aí que a checagem ingênua dizia "tudo ok".
 */
/**
 * Código do NAVEGADOR como string, de propósito.
 *
 * `tsx`/esbuild roda com `keepNames`, que embrulha todo arrow nomeado num helper
 * `__name(...)` — helper que existe no processo Node e NÃO no contexto da página.
 * Passar a função direto para `page.evaluate` morre com "__name is not defined"
 * assim que o corpo tem um `const f = () => …`. String passa intacta.
 */
const CONTRASTE_JS = `(function (minimo) {
  /* Tailwind v4 emite oklch(), e getComputedStyle DEVOLVE oklch() — não rgb().
     Um parser de "pegue os números da string" lê oklch(0.922 0 0) como
     r=0.922,g=0,b=0 e conclui 1.00:1 para a página inteira: o detector reprova
     tudo e não mede nada. Em vez de reimplementar oklch→sRGB (e errar de novo no
     próximo espaço de cor), PINTA a cor num canvas 1×1 e lê o pixel. Funciona
     para qualquer sintaxe que o navegador entenda, hoje e depois. */
  var cv = document.createElement("canvas"); cv.width = cv.height = 1;
  var ctx = cv.getContext("2d", { willReadFrequently: true });
  var cache = {};
  function rgb(s) {
    if (cache[s]) return cache[s];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = s;                    /* inválida ⇒ fillStyle não muda */
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    var out = [d[0], d[1], d[2], d[3] / 255];
    cache[s] = out;
    return out;
  }
  function canal(v) { var c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * canal(c[0]) + 0.7152 * canal(c[1]) + 0.0722 * canal(c[2]); }
  /* Fundo EFETIVO: sobe a árvore compondo camadas semitransparentes. O
     backgroundColor do próprio nó é quase sempre rgba(0,0,0,0) — era aí que a
     checagem ingênua dizia "tudo ok". */
  function fundo(el) {
    var acc = null, node = el;
    while (node) {
      var p = rgb(getComputedStyle(node).backgroundColor), a = p[3];
      if (a > 0) {
        acc = acc
          ? [acc[0] * (1 - a) + p[0] * a, acc[1] * (1 - a) + p[1] * a, acc[2] * (1 - a) + p[2] * a]
          : [p[0], p[1], p[2]];
        if (a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    return acc || [10, 10, 10];
  }

  var ruins = [], vistos = {};
  var todos = document.querySelectorAll("body *");
  for (var i = 0; i < todos.length; i++) {
    var el = todos[i];
    /* Só nós com texto PRÓPRIO — senão um container herda a queixa do filho. */
    var texto = "";
    for (var j = 0; j < el.childNodes.length; j++) {
      if (el.childNodes[j].nodeType === 3) texto += " " + (el.childNodes[j].textContent || "").trim();
    }
    texto = texto.trim();
    if (!texto) continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.1) continue;
    var f = rgb(cs.color), fa = f[3];
    if (fa < 0.1) continue;
    var bg = fundo(el);
    var fg = [f[0] * fa + bg[0] * (1 - fa), f[1] * fa + bg[1] * (1 - fa), f[2] * fa + bg[2] * (1 - fa)];
    var l1 = lum(fg), l2 = lum(bg);
    var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < minimo) {
      var chave = texto.slice(0, 24) + "|" + cs.color;
      if (vistos[chave]) continue;
      vistos[chave] = 1;
      ruins.push('"' + texto.slice(0, 28) + '" ' + ratio.toFixed(2) + ":1 (" + cs.color +
        " sobre rgb(" + bg.map(Math.round).join(",") + "))");
    }
  }
  return ruins;
})`;

async function contrasteRuim(page: Page): Promise<string[]> {
  return page.evaluate(`${CONTRASTE_JS}(${CONTRASTE_MIN})`) as Promise<string[]>;
}

async function rodar(largura: number, altura: number, rotulo: string) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: largura, height: altura });
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 90000 });

    // O grid precisa ter DADOS REAIS. Um empty-state esconde todo estouro —
    // já aconteceu neste repo: as abas mediam limpo num período sem registros.
    let comCards = true;
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('[role="button"][tabindex="0"]').length > 3,
        { timeout: 30000 },
      );
    } catch { comCards = false; }
    assert(`[${rotulo}] grid carregou com dados reais`, comCards,
      comCards ? "" : "SEM CARDS — as medições abaixo não valem");

    // 1. Estouro horizontal do documento.
    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    assert(`[${rotulo}] página não rola horizontalmente`, doc.scroll <= doc.client + 1,
      `scrollWidth ${doc.scroll} × clientWidth ${doc.client}`);

    // 2. Nada CORTADO pela borda direita. A raiz é `overflow-hidden`: um
    //    elemento fora da tela não faz nada rolar, ele só desaparece.
    const cortados = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const fora: string[] = [];
      for (const el of Array.from(document.querySelectorAll("header button, header input, header a"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > w + 1 || r.left < -1) {
          const nome = (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 24);
          fora.push(`${nome} (${Math.round(r.left)}..${Math.round(r.right)} vs 0..${w})`);
        }
      }
      return fora;
    });
    assert(`[${rotulo}] nada cortado pela borda do header`, cortados.length === 0,
      cortados.join("; ") || "todos dentro");

    // 2b. CONTEÚDO CORTADO DENTRO DE UM PAINEL.
    //
    // A checagem acima não basta e já deixou passar a sidebar inteira ilegível a
    // 390px: a raiz é `overflow-hidden`, então um texto que transborda o painel
    // NÃO faz o documento rolar — ele só é cortado, em silêncio, e o portão
    // aprova. Mesma lição do portão do ingest: medir o elemento contra a caixa
    // que o contém, nunca contra o documento. Aqui: todo nó com texto próprio
    // cujo conteúdo é mais largo que a própria caixa (`scrollWidth` vs
    // `clientWidth`) SEM ter `truncate`/`text-overflow: ellipsis` declarado —
    // truncar é decisão de design; ser cortado pela borda não é.
    const espremidos = await page.evaluate(() => {
      const fora: string[] = [];
      const todos = document.querySelectorAll("aside *, [class*='flex-col'] > *, header *");
      for (let i = 0; i < todos.length; i++) {
        const el = todos[i] as HTMLElement;
        let texto = "";
        for (let j = 0; j < el.childNodes.length; j++) {
          if (el.childNodes[j].nodeType === 3) texto += " " + (el.childNodes[j].textContent || "").trim();
        }
        texto = texto.trim();
        if (!texto || texto.length < 3) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Caixa de largura irrisória = painel RECOLHIDO (collapsedSize 0 dentro de
        // overflow-hidden), não conteúdo espremido. O nó continua no DOM e mede
        // uns poucos px, mas ninguém o vê. Sem esta linha o portão reprovava a
        // sidebar justamente por ela estar corretamente escondida a 390px.
        if (r.width < 24) continue;
        const cs = getComputedStyle(el);
        if (cs.textOverflow === "ellipsis" || cs.overflow === "auto" || cs.overflow === "scroll") continue;
        // Sobra de 2px absorve arredondamento de subpixel.
        if (el.scrollWidth > el.clientWidth + 2) {
          fora.push('"' + texto.slice(0, 26) + '" ' + el.scrollWidth + "px de conteúdo em " + el.clientWidth + "px");
        }
      }
      return [...new Set(fora)].slice(0, 12);
    });
    assert(`[${rotulo}] nenhum texto cortado dentro do painel`, espremidos.length === 0,
      espremidos.length ? `${espremidos.length}:\n      ${espremidos.join("\n      ")}` : "nada espremido");

    // 3. Orçamento de cromo: px até o primeiro card.
    if (comCards) {
      const cromo = await page.evaluate(() => {
        const card = document.querySelector('main [role="button"][tabindex="0"]');
        return card ? Math.round(card.getBoundingClientRect().top) : -1;
      });
      assert(`[${rotulo}] cromo até o primeiro card ≤ ${CROMO_MAX}px`,
        cromo >= 0 && cromo <= CROMO_MAX, `${cromo}px`);
    }

    // 4. Piso de contraste.
    const ruins = await contrasteRuim(page);
    assert(`[${rotulo}] todo texto acima de ${CONTRASTE_MIN}:1`, ruins.length === 0,
      ruins.length ? `${ruins.length} abaixo do piso:\n      ${ruins.join("\n      ")}` : "todos legíveis");

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: join(SHOTS, `home-${rotulo}.png`) as `${string}.png`,
      fullPage: false,
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`\n  HOME VISUAL — ${BASE}\n`);
  await rodar(1920, 1080, "1920px");
  await rodar(390, 844, "390px");

  const falhas = checks.filter((c) => !c.ok);
  console.log(`\n  ${checks.length - falhas.length}/${checks.length} ok${falhas.length ? ` — ${falhas.length} FALHA(S)` : ""}`);
  console.log(`  Capturas em ${SHOTS}\n`);
  if (falhas.length) process.exit(1);
}

main().catch((e) => {
  console.error(`\n  Falhou: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
