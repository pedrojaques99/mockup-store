import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI!;
const dbName = process.env.MONGODB_DB_NAME!;

let client: MongoClient;
let db: Db;

export async function getDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
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
