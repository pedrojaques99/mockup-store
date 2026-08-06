/**
 * Driver local do catálogo — SQLite embutido do Node, zero dependência.
 *
 * ## Por que isto existe
 *
 * Medido em 06/08/2026: subindo o app **sem** `MONGODB_URI`, com
 * `PSD_DIRS=Z:/BOXY/Produtos` apontando para 112 PSDs, o catálogo devolve
 * **134 itens e nenhum PSD**. As cenas de foto vêm do disco; a metade PSD do
 * catálogo vem inteira do Mongo. Ou seja: sem banco, o acervo do usuário não
 * aparece — e um app público não pode exigir um cluster para listar os
 * arquivos que já estão na máquina de quem baixou.
 *
 * `node:sqlite` é a escolha porque é **biblioteca padrão do Node 22+**: nada
 * para compilar, nada de módulo nativo, nada que quebre um `npm ci` no Windows
 * de designer. `better-sqlite3` faria o mesmo trabalho cobrando build nativo
 * justamente no passo "clone e roda" que este projeto quer tornar trivial.
 *
 * ## Isto NÃO é um driver de Mongo
 *
 * É um adaptador para as **5 operações** que este app usa — medidas, não
 * supostas: `find`, `findOne`, `insertOne`, `updateOne` e a contagem de
 * dimensões (que era `aggregate` duplicado em dois lugares e virou função). O
 * subconjunto de filtros é igualmente pequeno: igualdade em campo de topo,
 * caminho pontilhado (`dimensions.mockup_type`), `$or` desses, e `$text`.
 *
 * Fora disso ele **estoura com nome próprio**. Essa é a regra que torna o
 * adaptador seguro: filtro não entendido nunca é ignorado, porque ignorar
 * silenciosamente devolveria a coleção inteira onde o chamador esperava um
 * recorte — e ninguém descobriria olhando a tela.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

export class FiltroNaoSuportado extends Error {
  constructor(detalhe: string) {
    super(
      `Filtro não suportado pelo catálogo local: ${detalhe}. ` +
        `O driver SQLite cobre igualdade, caminho pontilhado, $or e $text — ` +
        `veja src/lib/store-sqlite.ts. Não estou ignorando o filtro porque ` +
        `isso devolveria a coleção inteira em silêncio.`,
    );
    this.name = "FiltroNaoSuportado";
  }
}

type Doc = Record<string, unknown>;
type Filtro = Record<string, unknown>;

/** Coleções que o app usa. Criadas na abertura; o resto é erro de digitação. */
const COLECOES = ["community_presets", "psd_metadata"] as const;

export function caminhoDoBanco(): string {
  return process.env.LOCAL_DB_PATH || join(process.cwd(), "data", "catalog.sqlite");
}

let handle: DatabaseSync | null = null;

function abrir(): DatabaseSync {
  if (handle) return handle;
  const caminho = caminhoDoBanco();
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  // WAL: leitura não bloqueia escrita. O ingest escreve enquanto o grid lê.
  if (caminho !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  for (const c of COLECOES) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${c} (_key TEXT PRIMARY KEY, doc TEXT NOT NULL)`);
    // Índices nos campos por onde o app realmente busca (medido nos 9 arquivos).
    db.exec(
      `CREATE INDEX IF NOT EXISTS ${c}_id ON ${c} (json_extract(doc,'$.id'))`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS ${c}_filename ON ${c} (json_extract(doc,'$.fileName'))`,
    );
  }
  handle = db;
  return db;
}

export function fecharBanco() {
  handle?.close();
  handle = null;
}

/** `dimensions.mockup_type` → `$.dimensions.mockup_type`, com aspas onde precisa. */
function jsonPath(campo: string): string {
  return "$." + campo.split(".").map((p) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `"${p}"`)).join(".");
}

/**
 * Uma condição de igualdade. Campo cujo valor no doc é ARRAY conta como match
 * quando o array contém o valor — é o comportamento do Mongo, e o app depende
 * dele (`dimensions.mockup_type` é lista).
 */
function condicaoIgual(campo: string, valor: unknown, params: unknown[]): string {
  const p = jsonPath(campo);
  if (valor === null || valor === undefined) {
    return `json_extract(doc, '${p}') IS NULL`;
  }
  if (typeof valor === "boolean") {
    params.push(valor ? 1 : 0);
    return `json_extract(doc, '${p}') = ?`;
  }
  if (typeof valor === "number") {
    params.push(valor);
    return `json_extract(doc, '${p}') = ?`;
  }
  if (typeof valor !== "string") {
    throw new FiltroNaoSuportado(`valor de tipo ${typeof valor} em "${campo}"`);
  }
  // Escalar OU elemento de array, como o Mongo faz.
  params.push(valor, valor);
  return `(json_extract(doc, '${p}') = ? OR EXISTS (
      SELECT 1 FROM json_each(doc, '${p}') WHERE json_each.value = ?
    ))`;
}

/** Busca textual do `$text`: LIKE sobre os campos que carregam texto de verdade. */
function condicaoTexto(busca: string, params: unknown[]): string {
  const termos = busca.split(/\s+/).filter(Boolean).slice(0, 8);
  if (!termos.length) return "1=1";
  const porTermo = termos.map((t) => {
    params.push(`%${t.toLowerCase()}%`, `%${t.toLowerCase()}%`, `%${t.toLowerCase()}%`);
    return `(lower(json_extract(doc,'$.name')) LIKE ?
      OR lower(json_extract(doc,'$.description')) LIKE ?
      OR lower(json_extract(doc,'$.tags')) LIKE ?)`;
  });
  return `(${porTermo.join(" OR ")})`;
}

function traduzir(filtro: Filtro, params: unknown[]): string {
  const partes: string[] = [];
  for (const [campo, valor] of Object.entries(filtro ?? {})) {
    if (campo === "$or") {
      if (!Array.isArray(valor) || !valor.length) throw new FiltroNaoSuportado("$or vazio");
      partes.push(`(${valor.map((sub) => traduzir(sub as Filtro, params)).join(" OR ")})`);
      continue;
    }
    if (campo === "$text") {
      const busca = (valor as { $search?: string })?.$search;
      if (typeof busca !== "string") throw new FiltroNaoSuportado("$text sem $search");
      partes.push(condicaoTexto(busca, params));
      continue;
    }
    if (campo.startsWith("$")) throw new FiltroNaoSuportado(`operador ${campo}`);
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      const ops = Object.keys(valor as object);
      if (ops.some((o) => o.startsWith("$"))) {
        // `{ $exists: true }` é o único que aparece e tem tradução direta.
        const ex = (valor as { $exists?: boolean }).$exists;
        if (ops.length === 1 && typeof ex === "boolean") {
          partes.push(`json_extract(doc, '${jsonPath(campo)}') IS ${ex ? "NOT NULL" : "NULL"}`);
          continue;
        }
        throw new FiltroNaoSuportado(`operadores ${ops.join(",")} em "${campo}"`);
      }
    }
    partes.push(condicaoIgual(campo, valor, params));
  }
  return partes.length ? partes.join(" AND ") : "1=1";
}

function chaveDe(doc: Doc): string {
  const id = doc.id ?? doc.fileName ?? doc._id;
  if (typeof id === "string" && id) return id;
  return `auto-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/** Cursor com a fatia de API que o app usa: `sort`, `limit`, `toArray`. */
class Cursor {
  private ordem: [string, 1 | -1][] = [];
  private teto: number | null = null;
  constructor(
    private db: DatabaseSync,
    private colecao: string,
    private where: string,
    private params: unknown[],
  ) {}

  sort(spec: Record<string, 1 | -1>) {
    this.ordem = Object.entries(spec) as [string, 1 | -1][];
    return this;
  }

  limit(n: number) {
    this.teto = n;
    return this;
  }

  async toArray(): Promise<Doc[]> {
    let sql = `SELECT doc FROM ${this.colecao} WHERE ${this.where}`;
    if (this.ordem.length) {
      sql += ` ORDER BY ${this.ordem
        .map(([c, d]) => `json_extract(doc,'${jsonPath(c)}') ${d === -1 ? "DESC" : "ASC"}`)
        .join(", ")}`;
    }
    if (this.teto != null) sql += ` LIMIT ${Math.max(0, Math.floor(this.teto))}`;
    const linhas = this.db.prepare(sql).all(...(this.params as never[])) as { doc: string }[];
    return linhas.map((l) => JSON.parse(l.doc) as Doc);
  }
}

/**
 * A projeção do Mongo é **ignorada de propósito**: ela é otimização de tráfego,
 * e aqui o banco é um arquivo local. Devolver o documento inteiro é sempre
 * seguro para quem lê campos nomeados — que é o que os 9 chamadores fazem.
 */
class Colecao {
  constructor(private db: DatabaseSync, private nome: string) {}

  find(filtro: Filtro = {}, _opcoes?: unknown): Cursor {
    const params: unknown[] = [];
    return new Cursor(this.db, this.nome, traduzir(filtro, params), params);
  }

  async findOne(filtro: Filtro = {}, _opcoes?: unknown): Promise<Doc | null> {
    const [primeiro] = await this.find(filtro).limit(1).toArray();
    return primeiro ?? null;
  }

  async countDocuments(filtro: Filtro = {}): Promise<number> {
    const params: unknown[] = [];
    const where = traduzir(filtro, params);
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${this.nome} WHERE ${where}`)
      .get(...(params as never[])) as { n: number };
    return r?.n ?? 0;
  }

  async insertOne(doc: Doc): Promise<{ acknowledged: true; insertedId: string }> {
    const key = chaveDe(doc);
    this.db
      .prepare(`INSERT OR REPLACE INTO ${this.nome} (_key, doc) VALUES (?, ?)`)
      .run(key, JSON.stringify(doc));
    return { acknowledged: true, insertedId: key };
  }

  async updateOne(
    filtro: Filtro,
    update: { $set?: Doc },
    opcoes?: { upsert?: boolean },
  ): Promise<{ acknowledged: true; matchedCount: number; upsertedCount: number }> {
    if (!update?.$set) throw new FiltroNaoSuportado(`update sem $set em ${this.nome}`);
    const alvo = await this.findOne(filtro);
    if (alvo) {
      const novo = { ...alvo, ...update.$set };
      // Localiza pela chave do doc ANTIGO. Pela do novo, um `$set` que mexesse
      // em `id`/`fileName` apontaria para uma linha inexistente e o UPDATE não
      // gravaria nada — sem erro, sem aviso.
      this.db
        .prepare(`UPDATE ${this.nome} SET doc = ? WHERE _key = ?`)
        .run(JSON.stringify(novo), chaveDe(alvo));
      return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
    }
    if (!opcoes?.upsert) return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
    // Upsert: os campos de igualdade do filtro fazem parte do doc criado — é o
    // que o Mongo faz, e é o que o ingest espera ao gravar por `fileName`.
    const base: Doc = {};
    for (const [k, v] of Object.entries(filtro)) if (!k.startsWith("$")) base[k] = v;
    await this.insertOne({ ...base, ...update.$set });
    return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
  }
}

export interface BancoLocal {
  collection(nome: string): Colecao;
}

export function bancoLocal(): BancoLocal {
  const db = abrir();
  return {
    collection(nome: string) {
      if (!(COLECOES as readonly string[]).includes(nome)) {
        throw new Error(
          `Coleção desconhecida no catálogo local: "${nome}". ` +
            `Conhecidas: ${COLECOES.join(", ")} (src/lib/store-sqlite.ts).`,
        );
      }
      return new Colecao(db, nome);
    },
  };
}
