/**
 * img-warm — pré-gera os derivados WebP das imagens do catálogo que moram fora
 * do `public/` (Google Drive, discos de trabalho).
 *
 * Para que serve: a primeira visita a um card paga a conversão do original —
 * e original aqui chega a 13 MB de PNG lido pela rede do Drive. Rodando isto
 * uma vez, a primeira dobra da home já nasce quente.
 *
 * É idempotente e retomável: derivado que já existe é pulado (a chave inclui
 * mtime, então arquivo trocado é reconvertido sozinho).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/img-warm.ts [--limit 500] [--w 1600]
 */
import { derivado, extensaoValida } from "../src/lib/image-cache";
import { searchRefs } from "../src/lib/search-index";

const arg = (nome: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const limite = Number(arg("limit")) || Infinity;
const largura = Number(arg("w")) || undefined;

function caminhoDe(url: string | undefined): string | null {
  if (!url?.startsWith("/api/local-image")) return null;
  const q = url.slice(url.indexOf("?") + 1);
  const p = new URLSearchParams(q).get("path");
  return p && extensaoValida(p) ? p : null;
}

async function main() {
  // Pede o catálogo inteiro pela busca (uma página gigante) — é o mesmo caminho
  // que a home usa, então aquece exatamente o que ela vai pedir.
  const { references } = await searchRefs({ page: 1, limit: 100_000 });
  const caminhos = [
    ...new Set(references.map((d) => caminhoDe(d.referenceImageUrl)).filter((p): p is string => !!p)),
  ].slice(0, limite);

  console.log(`${caminhos.length} imagens fora do public/ no catálogo\n`);

  let convertidos = 0;
  let jaTinha = 0;
  let falhas = 0;
  const t0 = Date.now();

  // Sequencial de propósito: quem controla o paralelismo é o semáforo do
  // image-cache (4 por vez). Disparar tudo aqui só empilharia promessas.
  for (const [i, p] of caminhos.entries()) {
    try {
      const d = await derivado(p, largura);
      if (d.doCache) jaTinha++;
      else convertidos++;
    } catch (e) {
      falhas++;
      console.warn(`  ! ${p.split(/[\\/]/).pop()}: ${e instanceof Error ? e.message : e}`);
    }
    if ((i + 1) % 50 === 0 || i + 1 === caminhos.length) {
      const seg = Math.round((Date.now() - t0) / 1000);
      process.stdout.write(
        `\r  ${i + 1}/${caminhos.length}  ${convertidos} novos · ${jaTinha} já tinham · ${falhas} falhas  (${seg}s)`
      );
    }
  }

  console.log(`\n\nfeito em ${Math.round((Date.now() - t0) / 1000)}s`);
  if (falhas) console.log(`${falhas} arquivo(s) que o sharp não abriu — a rota cai nos bytes originais para esses.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
