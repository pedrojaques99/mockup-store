import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

/**
 * Conecta no Mongo. Falha CEDO e com nome próprio: sem as variáveis, o
 * `new MongoClient(undefined)` estourava lá dentro do driver com uma mensagem
 * que não dizia o que fazer. Quem chama isto sabe tratar (`search-index.ts`
 * engole e cai para o catálogo de disco); quem não trata devolve 500, mas
 * agora com o motivo escrito.
 */
export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  const faltando = [
    !uri && "MONGODB_URI",
    !dbName && "MONGODB_DB_NAME",
  ].filter(Boolean);
  if (faltando.length) {
    throw new Error(
      `Mongo não configurado: falta ${faltando.join(" e ")} no .env.local. ` +
        `Veja .env.example — sem Mongo o catálogo funciona só com o disco.`,
    );
  }
  client = new MongoClient(uri!);
  await client.connect();
  db = client.db(dbName!);
  return db;
}

export interface Reference {
  _id: string;
  id: string;
  name: string;
  studio?: string;
  description: string;
  referenceImageUrl: string;
  dimensions: Record<string, string[]>;
  tags: string[];
  prompt: string;
  psdFileName?: string;
  psdPath?: string;
  smartObjectName?: string;
  soInnerWidth?: number;
  soInnerHeight?: number;
  /** "photo" for photo-pipeline mockups, undefined for PSD mockups */
  type?: "photo";
  /** Scene ID for photo mockups — maps to data/photo-scenes/{id} */
  photoSceneId?: string;
  createdAt: string;
  updatedAt: string;
}
