/**
 * console-check — o que a home grita no console, capturado em vez de adivinhado.
 *
 *   npx tsx scripts/console-check.ts --url http://localhost:3001
 *
 * Nasceu de um `[object Event]` reportado em runtime: 12 lugares faziam
 * `img.onerror = rej`, passando o Event do DOM ao `reject()`. A mensagem foi
 * corrigida, mas saber QUAL disparou exige olhar o console de um navegador de
 * verdade — nenhum teste deste repo exercita o caminho de falha de uma imagem.
 *
 * Registra `console` (error/warning), `pageerror` (exceção não capturada),
 * `unhandledrejection` e toda resposta HTTP >= 400. Sai 1 se houver erro.
 */
import puppeteer from "puppeteer";

const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : "") || "http://localhost:3000";

async function main() {
  console.log(`\n  CONSOLE — ${BASE}\n`);
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const erros: string[] = [];
  const avisos: string[] = [];
  const rede: string[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    page.on("console", (m) => {
      const t = m.type();
      if (t === "error") erros.push(`console.error: ${m.text()}`);
      else if (t === "warning") avisos.push(`console.warn: ${m.text()}`);
    });
    page.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) =>
      rede.push(`requestfailed: ${r.url().slice(0, 120)} — ${r.failure()?.errorText ?? "?"}`),
    );
    page.on("response", (r) => {
      if (r.status() >= 400) rede.push(`HTTP ${r.status()}: ${r.url().slice(0, 120)}`);
    });

    // Rejeição não capturada não passa por `pageerror`; precisa do listener.
    await page.evaluateOnNewDocument(() => {
      addEventListener("unhandledrejection", (e) => {
        const r = (e as PromiseRejectionEvent).reason;
        console.error(`unhandledrejection: ${r instanceof Error ? r.message : String(r)}`);
      });
    });

    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 90000 });
    // Deixa as imagens preguiçosas e os fetches secundários acontecerem.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 6000)));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 4000)));
  } finally {
    await browser.close();
  }

  const secao = (t: string, xs: string[]) => {
    console.log(`  ${t} (${xs.length})`);
    for (const x of [...new Set(xs)].slice(0, 25)) console.log(`    · ${x}`);
    if (!xs.length) console.log("    (nenhum)");
    console.log("");
  };
  secao("ERROS", erros);
  secao("AVISOS", avisos);
  secao("REDE", rede);

  if (erros.length) process.exit(1);
}

main().catch((e) => {
  console.error(`\n  Falhou: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
