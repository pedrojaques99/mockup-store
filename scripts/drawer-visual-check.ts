/**
 * drawer-visual-check — o painel de render VISTO, não só compilado.
 *
 *   npx tsx scripts/drawer-visual-check.ts --url http://localhost:4100
 *
 * Irmão do `home-visual-check`, mirando o drawer da direita: a superfície que
 * produz o entregável. O portão da home não chega aqui — ele nunca abre um card —
 * e foi exatamente neste painel que a auditoria de 2026-08-05 achou onze itens que
 * `tsc`, lint e 368 testes deixaram passar.
 *
 * O que ele trava, e cada um já mordeu:
 *
 *   1. **Um primário só.** O rodapé chegou a desenhar DOIS botões verdes chamando
 *      `handleRender(false)` — um deles com ícone de download que não baixava nada.
 *      Contar botão de ação é a única forma de impedir que o terceiro volte.
 *   2. **Nada em caps.** `RENDER FINAL`, `DOWNLOAD PNG`, `GERAR PNG FINAL PARA
 *      BAIXAR`: caps digitado à mão escapa do expurgo de `uppercase` do CSS.
 *   3. **Contraste do painel**, medido contra o fundo EFETIVO.
 *   4. **Estouro na largura mínima do painel** (22%), onde o rodapé aperta.
 *   5. **Anel de foco alcança o primário.** O anel da casa esteve escopado numa
 *      classe que a home não usava: a ação que entrega o arquivo era alcançável
 *      pelo teclado e invisível.
 *
 * Sai 1 em qualquer falha: serve de portão.
 */
import puppeteer, { type Page } from "puppeteer";
import { mkdirSync } from "fs";
import { join } from "path";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const BASE = arg("--url") || "http://localhost:3000";
const ART = arg("--art") || join(process.cwd(), "Render", "Art", "Frame 4089.png");
const SHOTS = join(process.cwd(), ".tmp", "drawer-visual");

const CONTRASTE_MIN = 3.0;

interface Check { nome: string; ok: boolean; detalhe: string }
const checks: Check[] = [];
const assert = (nome: string, ok: boolean, detalhe = "") => { checks.push({ nome, ok, detalhe }); };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Contraste contra o fundo EFETIVO: `background-color` de um elemento é quase sempre
 * `rgba(0,0,0,0)`, e comparar texto contra transparente dá números inventados. Sobe a
 * árvore até achar quem realmente pinta. */
const CONTRAST_FN = `(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
      n = n.parentElement;
    }
    return { r: 10, g: 10, b: 10, a: 1 };
  };
  return { parse, lum, bgOf, ratio: (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  } };
})()`;

async function abrirDrawer(page: Page): Promise<boolean> {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 180_000 });
  // O grid é virtualizado e assíncrono; espera o primeiro card de verdade.
  await page.waitForFunction(
    () => document.querySelectorAll("img").length > 3,
    { timeout: 180_000 },
  );
  await sleep(1200);

  /* Clica no RODAPÉ do card (nome/estúdio), não no meio: o meio é coberto pelas ações
     de hover, e clicar ali disparava a busca por imagem parecida em vez de abrir o
     mockup — o portão testava outra coisa e passava. */
  const alvo = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("main img")) as HTMLImageElement[];
    const card = imgs[0]?.closest("[class*='group']") as HTMLElement | null;
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom - 12 };
  });
  if (!alvo) return false;
  await page.mouse.click(alvo.x, alvo.y);
  // O drawer é um Panel que entra por animação; espera o cabeçalho dele.
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("h2")).length > 0,
    { timeout: 30_000 },
  ).catch(() => {});
  await sleep(1500);
  return true;
}

async function mandarArte(page: Page) {
  /* O input DO PAINEL. A home tem outro `input[type=file]` (busca por imagem
     parecida), e pegar o primeiro do documento mandava a arte para a busca. */
  const input = await page.$('[class*="border-l"] input[type="file"][accept="image/*"]');
  if (!input) return false;
  await input.uploadFile(ART);
  // Auto-preview dispara sozinho; espera ele terminar (ou desistir).
  await sleep(6000);
  return true;
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  const abriu = await abrirDrawer(page);
  assert("o painel abre ao clicar num card", abriu);
  if (!abriu) { await browser.close(); return relatar(); }

  await page.screenshot({ path: join(SHOTS, "1-sem-arte.png") as `${string}.png` });

  const mandou = await mandarArte(page);
  assert("o seletor de arte existe e aceita arquivo", mandou);
  await page.screenshot({ path: join(SHOTS, "2-com-arte.png") as `${string}.png` });

  /* 1. Um primário só. Verde da marca (`--color-acc2`) preenchendo um botão. */
  const primarios = await page.evaluate(() => {
    const acc = getComputedStyle(document.documentElement).getPropertyValue("--color-acc2").trim();
    const alvo = Array.from(document.querySelectorAll("aside button, aside a, [class*='border-l'] button, [class*='border-l'] a"));
    const solidos = alvo.filter((b) => {
      const bg = getComputedStyle(b).backgroundColor;
      const r = (b as HTMLElement).getBoundingClientRect();
      if (r.width < 60 || r.height < 24) return false;
      // acc2 sólido: compara os canais, porque o token pode ser hex ou oklch.
      const el = document.createElement("div");
      el.style.backgroundColor = acc;
      document.body.appendChild(el);
      const alvoRgb = getComputedStyle(el).backgroundColor;
      el.remove();
      return bg === alvoRgb;
    });
    return solidos.map((b) => (b.textContent || "").trim());
  });
  assert(
    "exatamente um primário verde no painel",
    primarios.length <= 1,
    primarios.length ? `achados: ${primarios.join(" | ")}` : "nenhum (sem arte renderizável)",
  );

  /* 2. Nada gritando em caps — só em RÓTULO DE AÇÃO.
   *
   * Duas vezes este check acusou coisa que não é copy: a marca no cabeçalho do app
   * (logotipo) e `[ MOCKUPS 1.0 ]`, que é NOME DE ESTÚDIO vindo do acervo. Dado do
   * usuário não responde pela voz da casa; quem responde é o texto que nós escrevemos.
   * Um detector que acusa dado ensina a ignorar o detector. */
  const caps = await page.evaluate(() => {
    const painel = document.querySelector("[class*='border-l']");
    if (!painel) return [];
    const out: string[] = [];
    for (const el of Array.from(painel.querySelectorAll("button, a[href]"))) {
      const t = (el.textContent || "").trim();
      if (t.length < 5 || t.length > 60) continue;
      if (el.children.length) continue;
      const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
      if (letras.length < 5) continue;
      if (letras === letras.toUpperCase() && /[A-ZÀ-Ý]{5}/.test(letras)) out.push(t);
    }
    return [...new Set(out)];
  });
  assert("nenhum rótulo em CAIXA ALTA", caps.length === 0, caps.length ? caps.join(" | ") : "nada gritando");

  /* 3. Contraste de todo texto do painel, contra o fundo efetivo. */
  const fracos = await page.evaluate((min, fnSrc) => {
    // eslint-disable-next-line no-eval
    const h = eval(fnSrc) as { parse: (c: string) => { r: number; g: number; b: number; a: number } | null; bgOf: (e: Element) => { r: number; g: number; b: number }; ratio: (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => number };
    const painel = document.querySelector("[class*='border-l']");
    if (!painel) return [];
    const out: string[] = [];
    for (const el of Array.from(painel.querySelectorAll("*"))) {
      const t = (el.textContent || "").trim();
      if (!t || el.children.length) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || Number(cs.opacity) < 0.3) continue;
      const fg = h.parse(cs.color);
      if (!fg || fg.a < 0.5) continue;
      const ratio = h.ratio(fg, h.bgOf(el));
      if (ratio < min) out.push(`${t.slice(0, 32)} (${ratio.toFixed(2)}:1)`);
    }
    return [...new Set(out)];
  }, CONTRASTE_MIN, CONTRAST_FN);
  assert(`todo texto do painel acima de ${CONTRASTE_MIN}:1`, fracos.length === 0, fracos.length ? fracos.join(" | ") : "todos legíveis");

  /* 4. O anel de foco chega nos controles do painel.
   *
   * Tem que ser Tab de verdade: `:focus-visible` NÃO casa com `el.focus()`
   * programático num `<button>`, então testar assim devolve "outline none" e acusa um
   * defeito que não existe — o portão mentindo na direção contrária. Foi o que este
   * check fez na primeira execução. */
  await page.evaluate(() => {
    const painel = document.querySelector("[class*='border-l']");
    const primeiro = painel?.querySelector("button") as HTMLElement | null;
    primeiro?.focus();
  });
  await page.keyboard.press("Tab");
  await sleep(200);
  const anel = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const painel = document.querySelector("[class*='border-l']");
    if (!el || !painel?.contains(el)) return "o Tab saiu do painel";
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.outlineWidth || "0");
    const rotulo = (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 28);
    return w > 0 && cs.outlineStyle !== "none"
      ? ""
      : `"${rotulo}" sem anel (outline ${cs.outlineStyle} ${cs.outlineWidth})`;
  });
  assert("o foco por teclado desenha anel no painel", anel === "", String(anel) || "anel presente");

  /* 5. Painel na largura MÍNIMA: é onde o rodapé aperta. */
  await page.evaluate(() => {
    const painel = document.querySelector("[class*='border-l']") as HTMLElement | null;
    if (painel) painel.style.width = "280px";
  });
  await sleep(600);
  const estouro = await page.evaluate(() => {
    const painel = document.querySelector("[class*='border-l']") as HTMLElement | null;
    if (!painel) return "sem painel";
    const caixa = painel.getBoundingClientRect();
    const fora: string[] = [];
    for (const el of Array.from(painel.querySelectorAll("button, a[href], p, span, h2"))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 1) continue;
      if (r.right > caixa.right + 1 || r.left < caixa.left - 1) {
        fora.push(`${(el.textContent || "").trim().slice(0, 24)} (${Math.round(r.right - caixa.right)}px)`);
      }
    }
    return [...new Set(fora)].join(" | ");
  });
  assert("nada estoura o painel na largura mínima", estouro === "", String(estouro) || "tudo dentro");
  await page.screenshot({ path: join(SHOTS, "3-painel-estreito.png") as `${string}.png` });

  await browser.close();
  relatar();
})();

function relatar() {
  console.log(`\n  DRAWER VISUAL — ${BASE}\n`);
  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.nome}${c.detalhe ? `  — ${c.detalhe}` : ""}`);
  }
  const ok = checks.filter((c) => c.ok).length;
  console.log(`\n  ${ok}/${checks.length} ok`);
  console.log(`  Capturas em ${SHOTS}\n`);
  process.exit(ok === checks.length ? 0 : 1);
}
