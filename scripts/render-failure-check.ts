/**
 * render-failure-check — as falhas do render entregam AVISO, nunca silêncio.
 *
 *   npx tsx scripts/render-failure-check.ts --url http://localhost:4100
 *
 * Portão de um defeito que passou por tsc, lint e 368 testes: o `handleRender` tinha
 * `if (completedJobId) { … }` SEM `else`. Stream que terminava sem o evento `complete`
 * (servidor fechando a conexão depois do 200) desligava o `rendering` no `finally` e
 * devolvia a tela ao estado anterior — sem resultado, sem erro, sem aviso. Quem esperou
 * 40 segundos não conseguia distinguir isso de ter clicado errado. A prévia tinha o
 * mesmo buraco, e ela dispara SOZINHA no hover-apply.
 *
 * Duas armadilhas que este script já pagou, e por isso ele existe como script:
 *
 *   - `curl localhost:4200` devolve 000 porque o render-server fala TCP puro, não HTTP.
 *     Quem confiar nesse check acha que testou com o backend fora e não testou nada. A
 *     falha aqui é INJETADA na resposta, que é o que o navegador de fato vê.
 *   - o toast do sonner some em ~4s: esperar e olhar depois reporta "nenhum aviso" para
 *     um aviso que apareceu. Aqui é polling.
 *   - `renderDisabled` inclui `rendering`: clicar durante a prévia automática é clicar
 *     em nada, e o portão passava verde sem nunca ter disparado um render.
 *
 * Casos:
 *   A  a requisição morre           -> `catch`
 *   B  200 com stream sem `complete` -> o `else` que antes não existia
 *   C  resposta de ERRO sem corpo    -> o `res.json()` seco que engolia o motivo
 *
 * O caso C é o mesmo defeito uma camada acima: `if (!res.ok) { await res.json() }`
 * estoura quando o corpo vem vazio (é o 500 que o Next devolve quando o handler
 * morre antes de responder — foi o que acontecia com arte acima de 10 MB, truncada
 * pelo clone de corpo do middleware). O `catch` de fora então mostrava
 * "SyntaxError: Unexpected end of JSON input": a mensagem do PARSER no lugar da
 * mensagem do problema. Avisar errado é quase tão caro quanto não avisar, porque
 * manda o usuário caçar o bug no lugar errado. Aqui o portão exige que o aviso
 * NÃO seja o do parser.
 */
/* Prova das DUAS falhas do render final, sem depender de derrubar o render-server.
 *
 * O `curl localhost:4200` retorna 000 porque o render-server fala TCP puro, não HTTP:
 * quem confiasse nesse check acharia que testou com o backend fora e não testou nada.
 * Aqui a falha é injetada na resposta, que é o que o navegador realmente vê.
 *
 *   caso A  a requisição morre        -> cai no `catch`
 *   caso B  200, stream SEM `complete` -> cai no `else` novo (era silêncio total)
 */
import puppeteer from "puppeteer";
import { join } from "path";

const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : "") || "http://localhost:4100";
const ART = join(process.cwd(), "Render", "Art", "Frame 4089.png");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CASO = (process.argv.find((a) => a === "A" || a === "B" || a === "C") || "A") as "A" | "B" | "C";

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  let postSaiu = false;
  page.on("request", (r) => {
    const alvo = r.url().includes("/api/render") && r.method() === "POST";
    if (!alvo) return void r.continue();
    postSaiu = true;
    if (CASO === "A") return void r.abort("failed");
    // Erro SEM corpo — exatamente o que o Next devolve quando o handler morre
    // antes de responder. É o que fazia o `res.json()` do cliente estourar.
    if (CASO === "C") return void r.respond({ status: 500, body: "" });
    // 200 com stream que termina sem evento `complete`: o servidor morreu no meio.
    return void r.respond({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"step":"loading","detail":"abrindo psd"}\n\n',
    });
  });

  // O tutorial de primeira visita abre sozinho, e num navegador de teste TODA
  // visita é a primeira. O overlay engole os cliques no grid.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("boxy.como-usar.v1", "1"); } catch { /* storage bloqueado */ }
  });
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 180_000 });
  await page.waitForFunction(() => document.querySelectorAll("img").length > 3, { timeout: 180_000 });
  await sleep(1200);

  let input = null;
  for (let i = 0; i < 8 && !input; i++) {
    const alvo = await page.evaluate((n) => {
      const img = document.querySelectorAll("main img")[n] as HTMLImageElement | undefined;
      const card = img?.closest("[class*='group']") as HTMLElement | null;
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.bottom - 12 };
    }, i);
    if (!alvo) continue;
    await page.mouse.click(alvo.x, alvo.y);
    await sleep(1800);
    input = await page.$('[class*="border-l"] input[type="file"][accept="image/*"]');
  }
  if (!input) { console.log("nenhum card com face editável"); await browser.close(); process.exit(1); }
  await input.uploadFile(ART);

  /* Espera o botão existir E estar habilitado. `renderDisabled` inclui `rendering`, e a
     prévia automática dispara sozinha ao anexar a arte: clicar enquanto ela roda é
     clicar em nada, e o portão passava verde sem NUNCA ter disparado um render. É a
     forma mais fácil de este script mentir, então o timeout é generoso e a falha é
     explícita em vez de silenciosa. */
  let habilitado = false;
  for (let i = 0; i < 120 && !habilitado; i++) {
    habilitado = await page.evaluate(() => {
      const painel = document.querySelector("[class*='border-l']");
      const b = Array.from(painel?.querySelectorAll("button") ?? []).find(
        (x) => /Gerar PNG/.test(x.textContent || ""),
      ) as HTMLButtonElement | undefined;
      return !!b && !b.disabled;
    });
    if (!habilitado) await sleep(500);
  }
  if (!habilitado) {
    console.log("SETUP FALHOU: o botão Gerar PNG nunca habilitou (arte não anexou, ou a prévia travou).");
    await browser.close();
    process.exit(2);
  }

  /* Grava TODO toast que aparecer, com MutationObserver instalado antes do clique.
     Polling perdia a janela: o sonner desmonta em ~4s, e uma varredura a cada 250ms
     que pega o DOM entre um render e outro reporta "nenhum aviso" para um aviso que
     existiu. Foi assim que este portão deu falso negativo em 2 de 4 rodadas — e um
     portão intermitente é pior que portão nenhum, porque ensina a ignorar o vermelho. */
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    new MutationObserver(() => {
      for (const el of Array.from(document.querySelectorAll("[data-sonner-toast]"))) {
        const t = (el.textContent || "").trim();
        if (t && !w.__toasts.includes(t)) w.__toasts.push(t);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  /* Clique de MOUSE de verdade, por coordenada. `el.click()` programático já deixou
     este portão verde sem nada acontecer: com o painel rolado, o botão existe no DOM,
     responde `disabled === false`, e o clique sintético não reproduz o caminho do
     usuário. Rola o botão até a vista e clica onde ele está. */
  const alvoBtn = await page.evaluate(() => {
    const painel = document.querySelector("[class*='border-l']")!;
    const b = Array.from(painel.querySelectorAll("button")).find((x) => /Gerar PNG/.test(x.textContent || "")) as HTMLElement | undefined;
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!alvoBtn) { console.log("SETUP FALHOU: botão Gerar PNG sumiu"); await browser.close(); process.exit(2); }
  /* Confere `disabled` NO INSTANTE do clique, não antes.
     A prévia automática dispara sozinha e liga `rendering`, que entra em
     `renderDisabled`: entre a espera e o clique o botão voltava a desabilitar, o clique
     caía num botão morto, e o portão reportava "nenhum aviso" — vermelho falso, num
     app que estava certo. `elementFromPoint` continua devolvendo o botão mesmo
     desabilitado, então olhar o ponto do clique não denuncia nada. */
  let clicou = false;
  for (let i = 0; i < 60 && !clicou; i++) {
    clicou = await page.evaluate((p) => {
      const el = document.elementFromPoint(p.x, p.y) as HTMLButtonElement | null;
      return !!el && el.tagName === "BUTTON" && !el.disabled;
    }, alvoBtn);
    if (!clicou) { await sleep(500); continue; }
    await page.mouse.click(alvoBtn.x, alvoBtn.y);
  }
  if (!clicou) { console.log("SETUP FALHOU: o botão nunca ficou clicável"); await browser.close(); process.exit(2); }

  let aviso: string[] = [];
  for (let i = 0; i < 120; i++) {
    aviso = await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts ?? []);
    if (aviso.length) break;
    await sleep(250);
  }
  /* O overlay de carregando não pode ficar girando para sempre depois da falha: o
     `finally` do handler é quem garante isso, e sem esta asserção um conserto que
     avisa E trava a tela passaria como sucesso. */
  const travado = await page.evaluate(
    () => !!document.querySelector('[class*="border-l"] [class*="animate-progress"]'),
  );
  const contexto = await page.evaluate(() => {
    const painel = document.querySelector("[class*='border-l']");
    const h2 = painel?.querySelector("h2")?.textContent?.trim();
    const temPastaPsd = !!Array.from(painel?.querySelectorAll("button") ?? []).find(
      (b) => (b.getAttribute("aria-label") || "") === "Abrir a pasta do PSD",
    );
    return { mockup: h2, temPsdPath: temPastaPsd };
  });
  console.log("  contexto:", JSON.stringify(contexto));
  console.log(`caso ${CASO} — POST saiu: ${postSaiu} | aviso: ${JSON.stringify(aviso)} | ainda girando: ${travado}`);
  await page.screenshot({ path: join(process.cwd(), ".tmp", "drawer-visual", `falha-${CASO}.png`) as `${string}.png` });
  await browser.close();
  /* Avisar não basta: o aviso tem que ser sobre o RENDER. Vazar o nome do erro do
     parser ("SyntaxError", "JSON input") é o modo de falha do caso C, e ele passa
     por qualquer checagem que só conte se houve toast. */
  const vazouParser = aviso.some((t) => /SyntaxError|JSON input|JSON\.parse/i.test(t));
  if (vazouParser) console.log("FALHOU: o aviso mostrou o erro do parser em vez do motivo do render.");
  process.exit(aviso.length && !vazouParser ? 0 : 1);
})();
