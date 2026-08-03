import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { addRuntimeDir } from "@/lib/psd-index";
import { walkDir } from "@/lib/fs-walk";
import { scanPsd, IMAGE_EXTS } from "@/lib/psd-scan";
import { invalidateCatalog } from "@/lib/search-index";
import { mockupSignature } from "@/lib/dedup";
import { existsSync } from "fs";

/**
 * Commit do ingest.
 *
 * Duas mudanças de fundo em relação à versão anterior:
 *
 * 1. **Aceita uma lista explícita de arquivos.** Antes a rota varria a pasta e
 *    engolia tudo; agora o `/scan` triou, o usuário decidiu, e aqui só entra o
 *    que ele marcou. Sem lista, o comportamento antigo continua valendo (o CLI
 *    e qualquer chamada existente seguem funcionando).
 * 2. **Deduplica pela assinatura do projeto** (`mockupSignature`, de
 *    `lib/dedup`) e não mais por `findOne({ name })` exato — que deixava
 *    "Falling Cards Blur" e "Falling-Cards-Blur (1)" entrarem os dois, criando
 *    no banco a duplicata que o grid depois tem de esconder no cliente.
 *
 * O progresso vai por SSE quando `stream: true`: ingerir 3 mil PSDs num POST
 * mudo deixa o botão travado por minutos sem nenhum sinal de vida.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const ALL_EXTS = new Set([...IMAGE_EXTS, ".psd"]);

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

interface RequestedFile {
  path: string;
  name: string;
  ext: string;
  sizeBytes?: number;
  /** Estúdio por arquivo — a UI deixa renomear antes de confirmar. */
  studio?: string;
}

function makeRefDoc(fields: {
  name: string;
  studio: string;
  referenceImageUrl: string;
  sourcePath: string;
  psdFileName?: string;
  psdPath?: string;
  psdSizeBytes?: number;
  seq: number;
  prefix: string;
}) {
  return {
    id: `local-${Date.now()}-${fields.prefix}-${fields.seq}`,
    name: fields.name,
    studio: fields.studio,
    description: "",
    referenceImageUrl: fields.referenceImageUrl,
    dimensions: {},
    tags: [fields.studio],
    category: "reference",
    isAdminCurated: true,
    source: "local-ingest",
    sourcePath: fields.sourcePath,
    psdFileName: fields.psdFileName,
    psdPath: fields.psdPath,
    psdSizeBytes: fields.psdSizeBytes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface IngestReport {
  folder: string;
  images: number;
  psds: number;
  referencesCreated: number;
  referencesSkipped: number;
  psdOnlyCreated: number;
  psdMetadataScanned: number;
  errors: string[];
  /** Cancelado no meio: o que já entrou continua no acervo, e o relatório diz onde parou. */
  cancelled?: boolean;
}

async function runIngest(
  normalizedPath: string,
  requested: RequestedFile[] | null,
  defaultStudio: string | undefined,
  onProgress?: (step: string, detail: string, done: number, total: number) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<IngestReport> {
  const folderName = normalizedPath.split("/").filter(Boolean).pop() || "Unknown";
  const studioFallback = defaultStudio?.trim() || folderName;

  // Sem lista explícita, varre como antes — as chamadas antigas seguem válidas.
  const files =
    requested && requested.length
      ? requested.map((f) => ({
          name: f.name,
          path: f.path.replace(/\\/g, "/"),
          ext: f.ext.toLowerCase(),
          sizeBytes: f.sizeBytes ?? 0,
          studio: f.studio?.trim() || studioFallback,
        }))
      : walkDir(normalizedPath, ALL_EXTS).map((f) => ({
          name: f.name,
          path: f.path,
          ext: f.ext,
          sizeBytes: f.sizeBytes,
          studio: studioFallback,
        }));

  const images = files.filter((f) => IMAGE_EXTS.has(f.ext));
  const psds = files.filter((f) => f.ext === ".psd");

  const db = await getDb();
  const col = db.collection("community_presets");
  const psdMetaCol = db.collection("psd_metadata");

  if (psds.length > 0) addRuntimeDir(normalizedPath);

  // Assinaturas já no banco, carregadas de uma vez. O laço antigo fazia um
  // findOne por arquivo — numa pasta de 3 mil itens são 3 mil round-trips.
  const known = new Set<string>();
  for (const d of await col
    .find({ category: "reference" }, { projection: { name: 1, psdSizeBytes: 1 } })
    .toArray()) {
    known.add(mockupSignature(String(d.name ?? ""), Number(d.psdSizeBytes) || undefined));
  }

  const psdByName = new Map(psds.map((p) => [p.name.toLowerCase(), p]));
  const report: IngestReport = {
    folder: normalizedPath,
    images: images.length,
    psds: psds.length,
    referencesCreated: 0,
    referencesSkipped: 0,
    psdOnlyCreated: 0,
    psdMetadataScanned: 0,
    errors: [],
  };

  // Cancelar durante a gravação não pode desfazer o que já entrou no Mongo (não
  // há transação aqui). A regra é parar no PRÓXIMO item e devolver o relatório
  // do que entrou, para o usuário saber exatamente onde parou.
  const cancelado = () => signal?.aborted === true;

  const totalSteps = images.length + psds.length + psds.length;
  let step = 0;
  const tick = async (label: string, detail: string) => {
    step++;
    if (onProgress && (step % 5 === 0 || step === totalSteps)) {
      await onProgress(label, detail, step, totalSteps);
      await yieldToEventLoop();
    }
  };

  for (const img of images) {
    if (cancelado()) break;
    const matchedPsd = psdByName.get(img.name.toLowerCase());
    const sig = mockupSignature(img.name, matchedPsd?.sizeBytes);
    if (known.has(sig)) {
      report.referencesSkipped++;
      await tick("skip", img.name);
      continue;
    }
    known.add(sig);
    try {
      await col.insertOne(
        makeRefDoc({
          name: img.name,
          studio: img.studio,
          referenceImageUrl: `/api/local-image?path=${encodeURIComponent(img.path)}`,
          sourcePath: normalizedPath,
          psdFileName: matchedPsd?.name,
          psdPath: matchedPsd?.path,
          psdSizeBytes: matchedPsd?.sizeBytes,
          seq: report.referencesCreated,
          prefix: "img",
        }),
      );
      report.referencesCreated++;
    } catch (err) {
      report.errors.push(`${img.name}: ${String((err as Error)?.message ?? err)}`);
    }
    await tick("ref", img.name);
  }

  for (const psd of psds) {
    if (cancelado()) break;
    if (images.some((img) => img.name.toLowerCase() === psd.name.toLowerCase())) {
      await tick("skip", psd.name);
      continue;
    }
    const sig = mockupSignature(psd.name, psd.sizeBytes);
    if (known.has(sig)) {
      report.referencesSkipped++;
      await tick("skip", psd.name);
      continue;
    }
    known.add(sig);
    try {
      await col.insertOne(
        makeRefDoc({
          name: psd.name,
          studio: psd.studio,
          referenceImageUrl: "",
          sourcePath: normalizedPath,
          psdFileName: psd.name,
          psdPath: psd.path,
          psdSizeBytes: psd.sizeBytes,
          seq: report.psdOnlyCreated,
          prefix: "psd",
        }),
      );
      report.psdOnlyCreated++;
    } catch (err) {
      report.errors.push(`${psd.name}: ${String((err as Error)?.message ?? err)}`);
    }
    await tick("psd", psd.name);
  }

  for (const psd of psds) {
    if (cancelado()) break;
    try {
      if (await psdMetaCol.findOne({ fileName: psd.name })) {
        await tick("meta", psd.name);
        continue;
      }
      const meta = scanPsd(psd.path);
      if (meta) {
        await psdMetaCol.updateOne({ fileName: meta.fileName }, { $set: meta }, { upsert: true });
        report.psdMetadataScanned++;
      }
    } catch (err) {
      // Um PSD corrompido não pode derrubar o lote inteiro — vira linha de erro.
      report.errors.push(`${psd.name} (metadata): ${String((err as Error)?.message ?? err)}`);
    }
    await tick("meta", psd.name);
  }

  // Acervo mudou → o catálogo cacheado da busca precisa ser refeito.
  invalidateCatalog();
  if (cancelado()) report.cancelled = true;
  return report;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    folderPath?: string;
    files?: RequestedFile[];
    studio?: string;
    stream?: boolean;
  };
  const folderPath = body?.folderPath;
  if (!folderPath || typeof folderPath !== "string") {
    return NextResponse.json({ error: "folderPath required" }, { status: 400 });
  }

  const normalizedPath = folderPath.replace(/\\/g, "/");
  if (!existsSync(normalizedPath)) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const requested = Array.isArray(body.files) ? body.files : null;
  if (requested && requested.length === 0) {
    return NextResponse.json({ error: "Nenhum arquivo selecionado" }, { status: 400 });
  }

  if (!body.stream) {
    try {
      return NextResponse.json(
        await runIngest(normalizedPath, requested, body.studio, undefined, req.signal),
      );
    } catch (err) {
      return NextResponse.json(
        { error: String((err as Error)?.message ?? err) },
        { status: 500 },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      // Fechar a aba no meio da gravação deixava o servidor escrevendo no Mongo
      // sem ninguém do outro lado. Agora o abort chega ao laço, que para no
      // próximo item e devolve o que entrou.
      const abortar = () => controller.close();
      req.signal.addEventListener("abort", abortar, { once: true });
      try {
        send({ type: "start", folder: normalizedPath, total: requested?.length ?? 0 });
        const report = await runIngest(
          normalizedPath,
          requested,
          body.studio,
          (stepName, detail, done, total) => {
            send({
              type: "progress",
              step: stepName,
              detail,
              done,
              total,
              pct: total ? Math.round((done / total) * 100) : 100,
            });
          },
          req.signal,
        );
        send({ type: "complete", ...report });
      } catch (err) {
        if (!req.signal.aborted) {
          send({ type: "error", message: String((err as Error)?.message ?? err) });
        }
      } finally {
        req.signal.removeEventListener("abort", abortar);
        try {
          controller.close();
        } catch {
          /* já fechado pelo abort */
        }
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
