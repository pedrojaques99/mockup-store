import { MongoClient, Db } from "mongodb";
import { bancoLocal } from "./store-sqlite";

let client: MongoClient;
let db: Db;

/**
 * Qual driver está valendo nesta máquina.
 *
 * `mongo` quando as duas variáveis existem (o operador pediu explicitamente);
 * `local` no resto — que é o caso do usuário que baixou o app.
 */
export function driverAtivo(): "mongo" | "local" {
  const uri = (process.env.MONGODB_URI ?? "").trim();
  const nome = (process.env.MONGODB_DB_NAME ?? "").trim();
  return uri && nome ? "mongo" : "local";
}

/**
 * O catálogo. **SQLite local por padrão, Mongo quando configurado.**
 *
 * Antes isto era só Mongo e estourava sem ele — o que fazia ingest e publicar
 * responderem 500 numa máquina sem cluster. Medido: sem `MONGODB_URI`, com 112
 * PSDs no `PSD_DIRS`, o catálogo devolvia 134 itens e **nenhum PSD**. O acervo
 * de quem baixou o app não aparecia, e era esse o bloqueio para o produto ser
 * público.
 *
 * O tipo de retorno continua `Db` porque os 9 chamadores falam a fatia comum
 * (`collection().find/findOne/insertOne/updateOne`); o driver local implementa
 * exatamente essa fatia e **estoura com nome** no que não cobre — nunca devolve
 * resultado errado calado. Ver `store-sqlite.ts`.
 */
export async function getDb(): Promise<Db> {
  if (driverAtivo() === "local") {
    return bancoLocal() as unknown as Db;
  }
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  db = client.db(process.env.MONGODB_DB_NAME!);
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
