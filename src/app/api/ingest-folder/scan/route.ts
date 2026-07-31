import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { open, stat } from "fs/promises";
import { walkDir } from "@/lib/fs-walk";
import { IMAGE_EXTS } from "@/lib/psd-scan";
import { hashImage } from "@/lib/perceptual-hash";
import { mockupSignature } from "@/lib/dedup";
import { triage, type ScanCandidate, type TriagedItem, type TriageSummary } from "@/lib/ingest-triage";
import { getDb } from "@/lib/db";

/**
 * Pré-voo do ingest. Não escreve nada — só olha a pasta e devolve um veredito
 * por arquivo (novo / duplicata / lixo / já existe).
 *
 * Antes esta rota devolvia duas contagens (`psdCount`, `refCount`) e o wizard
 * pedia confirmação em cima disso: o usuário autorizava uma escrita irreversível
 * no Mongo sem ver um único arquivo. Ingest é superfície de trust — o custo de
 * hashear a pasta é ordens de grandeza menor que o de limpar um acervo poluído.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const ALL_EXTS = new Set([...IMAGE_EXTS, ".psd"]);
/** Só os 2 primeiros MB do PSD — arquivos aqui passam de 1 GB. Mesmo corte de /api/duplicates. */
const HASH_SLICE = 2 * 1024 * 1024;
/** Decodificação é CPU-bound; acima disto o libvips só disputa núcleo consigo mesmo. */
const CONCURRENCY = 8;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

async function partialHash(path: string): Promise<string | undefined> {
  try {
    const { size } = await stat(path);
    const fd = await open(path, "r");
    const len = Math.min(HASH_SLICE, size);
    const buf = Buffer.allocUnsafe(len);
    try {
      await fd.read(buf, 0, len, 0);
    } finally {
      await fd.close();
    }
    return `${size}:${createHash("md5").update(buf).digest("hex")}`;
  } catch {
    return undefined;
  }
}

/**
 * O que o acervo já tem, para o veredito `exists`.
 *
 * Mongo offline é caminho documentado deste projeto (AGENTS.md). Cair aqui não
 * pode derrubar o scan inteiro — degrada para "não sei o que já existe", que é
 * pior que o ideal e MUITO melhor que impedir o usuário de ingerir. O `degraded`
 * volta na resposta para a UI dizer isso em vez de fingir que checou.
 */
async function loadExisting(): Promise<{
  signatures: Set<string>;
  paths: Set<string>;
  degraded: boolean;
}> {
  const signatures = new Set<string>();
  const paths = new Set<string>();
  try {
    const db = await getDb();
    const docs = await db
      .collection("community_presets")
      .find(
        { category: "reference" },
        { projection: { name: 1, psdSizeBytes: 1, psdPath: 1 } },
      )
      .toArray();
    for (const d of docs) {
      signatures.add(mockupSignature(String(d.name ?? ""), Number(d.psdSizeBytes) || undefined));
      if (d.psdPath) paths.add(String(d.psdPath).replace(/\\/g, "/"));
    }
    return { signatures, paths, degraded: false };
  } catch {
    return { signatures, paths, degraded: true };
  }
}

interface ScanOutcome {
  items: TriagedItem[];
  summary: TriageSummary;
  degraded: boolean;
  folder: string;
}

async function runScan(
  normalized: string,
  onProgress?: (done: number, total: number, currentFile: string) => Promise<void> | void,
): Promise<ScanOutcome> {
  const files = walkDir(normalized, ALL_EXTS);
  const existing = await loadExisting();

  const candidates: ScanCandidate[] = files.map((f) => ({
    path: f.path,
    name: f.name,
    ext: f.ext,
    sizeBytes: f.sizeBytes,
    folder: f.folder,
  }));

  let done = 0;
  const total = candidates.length;

  // Pool de tamanho fixo em vez de Promise.all na lista inteira: uma pasta com
  // 4 mil imagens abriria 4 mil handles de arquivo de uma vez.
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(CONCURRENCY, total)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= candidates.length) return;
      const c = candidates[i];
      if (c.ext === ".psd") {
        c.contentHash = await partialHash(c.path);
      } else {
        const h = await hashImage(c.path);
        if (h) {
          c.phash = h.phash;
          c.width = h.width;
          c.height = h.height;
        }
      }
      done++;
      if (onProgress && (done % 10 === 0 || done === total)) {
        await onProgress(done, total, c.path.split("/").pop() ?? "");
        await yieldToEventLoop();
      }
    }
  });
  await Promise.all(workers);

  const { items, summary } = triage({
    candidates,
    existingSignatures: existing.signatures,
    existingPaths: existing.paths,
  });

  return {
    items,
    summary,
    degraded: existing.degraded,
    folder: normalized.split("/").filter(Boolean).pop() || "Unknown",
  };
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  const isStream = req.nextUrl.searchParams.get("stream") === "1";
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  const normalized = path.replace(/\\/g, "/");
  if (!existsSync(normalized)) {
    return NextResponse.json({ error: "Pasta não encontrada" }, { status: 404 });
  }

  if (!isStream) {
    const out = await runScan(normalized);
    return NextResponse.json({
      ...out,
      // Compatibilidade com o formato antigo desta rota.
      psdCount: out.items.filter((i) => i.ext === ".psd").length,
      refCount: out.items.filter((i) => i.ext !== ".psd").length,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        send({ type: "start", folder: normalized });
        const out = await runScan(normalized, (done, total, currentFile) => {
          send({
            type: "progress",
            done,
            total,
            pct: total ? Math.round((done / total) * 100) : 100,
            currentFile,
          });
        });
        send({ type: "complete", ...out });
      } catch (err) {
        send({ type: "error", message: String((err as Error)?.message ?? err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
