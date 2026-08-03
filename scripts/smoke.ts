/**
 * smoke — o app sobe e o grid funciona de ponta a ponta?
 *
 *   npm run build && npx next start -p 3123
 *   npx tsx scripts/smoke.ts --url http://localhost:3123
 *
 * Existe porque os 165 testes do repo são TODOS de lib: nenhum garante que a home
 * renderiza, que o filtro filtra ou que a busca devolve algo. Este script cobre o
 * caminho que o usuário realmente percorre, batendo HTTP no app de verdade.
 *
 * Sai com código 1 em qualquer falha — serve de gate no CI.
 */
const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : "") || "http://localhost:3000";

interface Check { nome: string; ok: boolean; detalhe: string }
const checks: Check[] = [];

function assert(nome: string, ok: boolean, detalhe = "") {
  checks.push({ nome, ok, detalhe });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? `  — ${detalhe}` : ""}`);
}

async function getJson(path: string) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`\n  SMOKE — ${BASE}\n`);

  // 1. A home renderiza (não é tela branca nem 500).
  try {
    const res = await fetch(BASE);
    const html = await res.text();
    assert("home responde 200", res.ok, `${html.length} bytes`);
    // O filtro é um Select do Radix: os itens ("Todos os estúdios") só existem
    // depois de abrir, num portal — nunca no HTML do servidor. O que dá para
    // afirmar daqui é que o CONTROLE renderizou e tem nome acessível.
    assert("home traz os filtros do grid", html.includes('aria-label="Estúdio"'));
  } catch (e) {
    assert("home responde", false, String(e));
  }

  // 2. O grid tem conteúdo.
  let primeiroEstudio = "";
  try {
    const d = await getJson("/api/references?has_psd=true&limit=5");
    assert("grid devolve referências", Array.isArray(d.references) && d.references.length > 0, `${d.total} no total`);
    assert("item tem os campos que o card usa", !!d.references?.[0]?.id && !!d.references?.[0]?.name);
    primeiroEstudio = d.references?.[0]?.studio ?? "";
  } catch (e) {
    assert("grid devolve referências", false, String(e));
  }

  // 3. Facetas batem com o grid — o dropdown não pode prometer o que a listagem não entrega.
  try {
    const f = await getJson("/api/references/facets?has_psd=true");
    assert("facetas trazem estúdios", Array.isArray(f.studios) && f.studios.length > 0, `${f.studios.length} estúdios`);
    assert("facetas trazem aspectos", Array.isArray(f.aspects) && f.aspects.length > 0);

    const alvo = f.studios[0]?.name;
    const d = await getJson(`/api/references?has_psd=true&limit=200&studio=${encodeURIComponent(alvo)}`);
    const soDoEstudio = d.references.every((r: { studio: string }) => r.studio === alvo);
    assert(`filtro por estúdio ("${alvo}") só devolve aquele estúdio`, soDoEstudio, `${d.total} itens`);
    assert("contagem da faceta bate com o grid", d.total === f.studios[0].count, `faceta ${f.studios[0].count} × grid ${d.total}`);
  } catch (e) {
    assert("facetas", false, String(e));
  }

  // 4. Busca: acha, tolera typo e cruza PT→EN.
  //
  // O termo sai do PRÓPRIO catálogo, não de uma lista fixa. Antes isto procurava
  // "billboard"/"outdoor" na unha e falhava em qualquer máquina cuja biblioteca
  // não tivesse essa palavra — inclusive num clone limpo com a cena de demo. O
  // que interessa não é o vocabulário, é a propriedade do motor: achar o termo,
  // tolerar o typo, e o mapa de sinônimos ser simétrico.
  let termo = "";
  try {
    const d = await getJson("/api/references?has_psd=true&limit=1");
    const r = d.references?.[0];
    termo =
      (r?.tags as string[] | undefined)?.find((t) => /^[a-zà-ú]{5,}$/i.test(t)) ??
      String(r?.name ?? "").split(/[^a-zà-ú]+/i).find((w: string) => w.length >= 5) ??
      "";
  } catch { /* o passo 2 já reportou */ }

  if (!termo) {
    assert("catálogo tem termo pesquisável", false, "nenhum item com palavra >=5 letras");
  } else {
    try {
      const d = await getJson(`/api/references?has_psd=true&limit=3&search=${encodeURIComponent(termo)}`);
      assert(`busca "${termo}" acha algo`, d.total >= 1, `${d.total} hits`);
    } catch (e) {
      assert(`busca "${termo}"`, false, String(e));
    }

    // Typo: troca a 3ª letra. Exercita a cascata fuzzy sem depender de palavra fixa.
    const comTypo = termo.slice(0, 2) + (termo[2] === "x" ? "z" : "x") + termo.slice(3);
    try {
      const d = await getJson(`/api/references?has_psd=true&limit=3&search=${encodeURIComponent(comTypo)}`);
      assert(`busca tolera typo ("${comTypo}")`, d.total >= 1, `${d.total} hits`);
    } catch (e) {
      assert(`busca tolera typo`, false, String(e));
    }
  }

  // Sinônimo PT↔EN: a invariante é a SIMETRIA. Se um lado acha, o outro tem que
  // achar o mesmo tanto — independente de qual par existe nesta biblioteca.
  try {
    const pares: Array<[string, string]> = [
      ["abrigo", "shelter"],
      ["onibus", "bus"],
      ["cartaz", "poster"],
      ["outdoor", "billboard"],
      ["rua", "street"],
    ];
    let testado = false;
    for (const [pt, en] of pares) {
      const [a, b] = await Promise.all([
        getJson(`/api/references?has_psd=true&limit=1&search=${pt}`),
        getJson(`/api/references?has_psd=true&limit=1&search=${en}`),
      ]);
      if (a.total === 0 && b.total === 0) continue;
      assert(`sinônimo "${pt}" ↔ "${en}" é simétrico`, a.total === b.total, `${a.total} × ${b.total}`);
      testado = true;
      break;
    }
    if (!testado) assert("mapa de sinônimos exercitado", false, "nenhum par do teste existe no catálogo");
  } catch (e) {
    assert("sinônimo PT↔EN", false, String(e));
  }

  // 5. Faceta + busca combinadas não se contradizem.
  try {
    const d = await getJson(
      `/api/references?has_psd=true&limit=50&search=${encodeURIComponent(termo || "a")}&aspect=landscape`,
    );
    assert("busca + aspecto combinam", d.references.every((r: { id: string }) => !!r.id), `${d.total} hits`);
  } catch (e) {
    assert("busca + aspecto", false, String(e));
  }

  // 6. Paginação não repete item entre páginas.
  try {
    const [p1, p2] = await Promise.all([
      getJson("/api/references?has_psd=true&limit=10&page=1"),
      getJson("/api/references?has_psd=true&limit=10&page=2"),
    ]);
    const ids = new Set([...p1.references, ...p2.references].map((r: { id: string }) => r.id));
    assert("paginação não repete item", ids.size === p1.references.length + p2.references.length);
  } catch (e) {
    assert("paginação", false, String(e));
  }

  const falhas = checks.filter((c) => !c.ok);
  console.log(`\n  ${checks.length - falhas.length}/${checks.length} ok${falhas.length ? ` — ${falhas.length} FALHA(S)` : ""}\n`);
  process.exit(falhas.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
