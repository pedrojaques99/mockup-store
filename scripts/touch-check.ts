/**
 * touch-check — a home numa tela SEM mouse.
 *
 *   npx tsx scripts/touch-check.ts --url http://localhost:3000
 *
 * Existe por causa de um defeito real e reincidente: controle escondido atrás de
 * `opacity-0 group-hover` some para sempre em tablet, porque `:hover` nunca acontece.
 * O arquivo já tinha consertado isso uma vez (`REVEAL_OVERLAY`) e o defeito voltou nos
 * controles do canto do card — o que prova que a regra sozinha não segura: precisa de
 * um teste que rode sem mouse.
 *
 * Aqui o navegador é emulado SEM capacidade de hover (`hover: none`), que é o sinal que
 * o CSS usa. Se algum controle do card ficar com opacidade 0 nessas condições, ele é
 * inalcançável de verdade, e o script falha.
 *
 * Sai 1 se qualquer controle estiver invisível ou fora do alcance do teclado.
 */
import puppeteer from "puppeteer";

const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : "") || "http://localhost:3000";

async function main() {
  console.log(`\n  TOQUE (sem mouse) — ${BASE}\n`);
  const browser = await puppeteer.launch({
    headless: true,
    // `hover: none` e `pointer: coarse` são o que um tablet reporta. Sem estes flags o
    // Chrome headless diz que tem mouse fino, e o teste passaria sem testar nada.
    args: ["--no-sandbox", "--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2"],
  });
  const falhas: string[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768, hasTouch: true, isMobile: false });
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[role="button"]', { timeout: 60_000 });

    const hoverNone = await page.evaluate(() => matchMedia("(hover: none)").matches);
    console.log(`  emulação: (hover: none) = ${hoverNone}`);
    if (!hoverNone) {
      falhas.push("o navegador não entrou em modo sem-hover — o teste não testou nada");
    }

    // Primeiro card do grid, e todo botão dentro dele.
    const resultado = await page.evaluate(() => {
      const card = document.querySelector('[role="button"].group');
      if (!card) return { erro: "nenhum card no grid" };
      const botoes = [...card.querySelectorAll("button, a")];
      return {
        total: botoes.length,
        invisiveis: botoes
          .map((b) => {
            const cs = getComputedStyle(b);
            const rot = b.getAttribute("title") || b.getAttribute("aria-label") || b.textContent?.trim() || "(sem rótulo)";
            return { rot, opacity: Number(cs.opacity), visivel: cs.visibility !== "hidden" && cs.display !== "none" };
          })
          .filter((b) => b.opacity < 0.05 || !b.visivel),
        semRotulo: botoes
          .filter((b) => !b.getAttribute("title") && !b.getAttribute("aria-label") && !b.textContent?.trim())
          .length,
      };
    });

    if ("erro" in resultado) {
      falhas.push(String(resultado.erro));
    } else {
      console.log(`  controles no primeiro card: ${resultado.total}`);
      for (const b of resultado.invisiveis ?? []) {
        falhas.push(`invisível sem mouse: "${b.rot}" (opacity ${b.opacity})`);
      }
      if (resultado.semRotulo) falhas.push(`${resultado.semRotulo} controle(s) sem título nem aria-label`);
      if (!resultado.invisiveis?.length) console.log("  todos os controles do card alcançáveis sem mouse");
    }

    // Teclado: Tab tem de alcançar algum controle DENTRO do card.
    const alcancaTeclado = await page.evaluate(async () => {
      const card = document.querySelector('[role="button"].group');
      const alvo = card?.querySelector("button");
      if (!alvo) return false;
      (alvo as HTMLElement).focus();
      return document.activeElement === alvo && Number(getComputedStyle(alvo).opacity) > 0.05;
    });
    if (!alcancaTeclado) falhas.push("o foco de teclado não revela os controles do card");
    else console.log("  foco de teclado revela os controles");
  } finally {
    await browser.close();
  }

  console.log("");
  if (falhas.length) {
    console.log(`  ${falhas.length} FALHA(S):`);
    for (const f of falhas) console.log(`    · ${f}`);
    process.exit(1);
  }
  console.log("  OK — a home é operável sem mouse.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
