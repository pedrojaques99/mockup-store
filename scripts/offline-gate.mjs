/**
 * Portão do offline-first — o app sobe e serve SEM configuração nenhuma?
 *
 *   npm run check:offline        (precisa de um build: veja abaixo)
 *
 * É a única prova de que o produto pode ser distribuído. Todo o resto do
 * projeto roda numa máquina com `.env.local` cheio, Mongo ligado e três drives
 * montados — nada disso existe na máquina de quem baixa o app.
 *
 * ## Duas armadilhas que já deixaram este portão verde por engano
 *
 * 1. **O Next carrega `.env.local` sozinho.** Passar um `env` mínimo para o
 *    processo filho não basta: o servidor lê o arquivo do disco e sobe
 *    configurado. O portão ficava verde medindo o app COM tudo ligado. Por isso
 *    o arquivo sai do caminho durante o teste, e volta num `finally` que também
 *    roda em SIGINT e em exceção.
 * 2. **`kill` no shell não mata o `next start` no Windows.** O servidor
 *    sobrevivia à rodada e a próxima batia no ZUMBI da anterior — inclusive
 *    respondendo com a configuração antiga. `taskkill /T` mata a árvore.
 *
 * Pré-requisito: build num distDir próprio, para não brigar com o dev aberto.
 *   NEXT_DIST_DIR=.next-shipgate npx next build
 */
import { spawn, spawnSync } from "child_process";
import { mkdtempSync, renameSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// O Next carrega .env.local SOZINHO, entao "sem env" exige tirar o arquivo do
// caminho. Sem isto o portao fica verde testando o app CONFIGURADO — verde
// falso, que e pior que vermelho.
const ENV = ".env.local", BAK = ".env.local.portao-bak";
let movido = false;
const restaurar = () => { if (movido && existsSync(BAK)) { renameSync(BAK, ENV); movido = false; console.log("[.env.local restaurado]"); } };
process.on("exit", restaurar);
for (const s of ["SIGINT","SIGTERM","uncaughtException"]) process.on(s, () => { restaurar(); process.exit(1); });

if (existsSync(ENV)) { renameSync(ENV, BAK); movido = true; }

const tmp = mkdtempSync(join(tmpdir(), "boxy-zero-"));
const env = {
  PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP,
  NODE_ENV: "production", NEXT_DIST_DIR: ".next-shipgate",
  APP_CONFIG_PATH: join(tmp, "config.json"), LOCAL_DB_PATH: join(tmp, "catalog.sqlite"),
};
// No Windows, matar o shell NAO mata o `next start` que ele lancou: o servidor
// sobrevive e a proxima rodada bate no ZUMBI da anterior. Ja aconteceu aqui, e o
// portao ficou verde medindo o processo errado. `taskkill /T` mata a arvore.
const matarArvore = () => {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    else p.kill();
  } catch {}
};
const p = spawn("npx", ["next", "start", "-p", "4198"], { env, shell: true, stdio: ["ignore","pipe","pipe"] });
let log = ""; p.stdout.on("data", d => log += d); p.stderr.on("data", d => log += d);
const esperar = async () => { for (let i=0;i<60;i++){ try{ const r=await fetch("http://127.0.0.1:4198/api/config"); if(r.ok) return true; }catch{} await new Promise(r=>setTimeout(r,1000)); } return false; };
if (!await esperar()) { console.log("NAO SUBIU\n"+log.slice(-1200)); matarArvore(); restaurar(); process.exit(1); }

let falhas = 0;
const bater = async (nome, url) => {
  try { const r = await fetch("http://127.0.0.1:4198"+url); const t = await r.text();
    if(!r.ok) falhas++; console.log((r.ok?"OK   ":"FALHA")+" "+nome.padEnd(18)+r.status+"  "+t.slice(0,80).replace(/\n/g," ")); return t;
  } catch(e){ falhas++; console.log("FALHA "+nome+" -> "+e.message); return ""; }
};
console.log("--- app com ZERO configuracao ---");
await bater("home responde","/");
const grid = await bater("grid lista","/api/references?limit=3");
await bater("busca acha","/api/references?search=paper&limit=3");
await bater("facetas","/api/references/facets");
const cfg0 = JSON.parse(await bater("config le","/api/config"));
console.log("catalogo:", cfg0.catalogo, "| acervo:", cfg0.acervo.pastas.length, "pastas | chaves definidas:", cfg0.provedores.filter(p=>p.definida).length);

console.log("--- configurando PELO PAINEL (sem tocar em arquivo) ---");
const put = await fetch("http://127.0.0.1:4198/api/config",{method:"PUT",headers:{"Content-Type":"application/json"},
  body: JSON.stringify({ chaves:{ OPENAI_API_KEY:"sk-teste-1234567890abcdef" }, psdDirs:["Z:/BOXY/Produtos"] })});
console.log((put.ok?"OK   ":"FALHA")+" config grava      "+put.status);
if(!put.ok) falhas++;
const cfg1 = await (await fetch("http://127.0.0.1:4198/api/config")).json();
const o = cfg1.provedores.find(x=>x.chave==="OPENAI_API_KEY");
console.log("chave: definida="+o.definida+" mascara="+o.mascara+" origem="+o.origem);
const vazou = JSON.stringify(cfg1).includes("1234567890");
console.log("VAZOU A CHAVE EM CLARO?", vazou ? "SIM — BUG GRAVE" : "nao");
if (vazou) falhas++;
console.log("acervo agora:", JSON.stringify(cfg1.acervo.pastas));
if (o.origem !== "config") { console.log("FALHA: origem devia ser 'config'"); falhas++; }
matarArvore(); restaurar();
console.log(falhas ? "\n=== PORTAO VERMELHO: "+falhas+" ===" : "\n=== PORTAO VERDE ===");
process.exit(falhas?1:0);
