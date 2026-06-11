import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { open, stat } from "fs/promises";
import { walkDir } from "@/lib/fs-walk";

const SCAN_EXTS = new Set([".psd", ".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".psb"]);
const HASH_SLICE = 2 * 1024 * 1024;
const MIN_SIZE = 10 * 1024;

// Reads only the first 2MB — never loads the entire file into memory
async function partialHash(path: string): Promise<string> {
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
    return "";
  }
}

function keepScore(path: string): number {
  const parts = path.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1].toLowerCase();
  let score = 0;
  if (/copy|\bcopia\b|\(\d+\)|\bcópia\b/.test(filename)) score += 20;
  if (/ - \d+\./.test(filename)) score += 10;
  score += parts.length;
  return score;
}

interface DupeGroup {
  hash: string;
  sizeBytes: number;
  keepPath: string;
  removePaths: string[];
  wastedBytes: number;
}

interface ScanResult {
  groups: DupeGroup[];
  totalWastedBytes: number;
  filesScanned: number;
}

let cachedResult: ScanResult | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

function buildFileList(envDirs: string[]) {
  const allFiles: Array<{ path: string; sizeBytes: number }> = [];
  for (const dir of envDirs) {
    for (const e of walkDir(dir, SCAN_EXTS)) {
      if (e.sizeBytes >= MIN_SIZE) allFiles.push({ path: e.path, sizeBytes: e.sizeBytes });
    }
  }
  const bySize = new Map<number, Array<{ path: string; sizeBytes: number }>>();
  for (const f of allFiles) {
    const arr = bySize.get(f.sizeBytes);
    if (arr) arr.push(f);
    else bySize.set(f.sizeBytes, [f]);
  }
  const sizeGroups = [...bySize.values()].filter((g) => g.length >= 2);
  const candidateCount = sizeGroups.reduce((s, g) => s + g.length, 0);
  return { allFiles, sizeGroups, candidateCount };
}

// Yield to event loop so HTTP response can flush buffered data
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const isStream = searchParams.get("stream") === "1";
  if (searchParams.get("refresh") === "1") cachedResult = null;

  const envDirs = (process.env.PSD_DIRS || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  if (!envDirs.length) {
    if (isStream) {
      const enc = new TextEncoder();
      const body = enc.encode(
        `data: {"type":"complete","filesScanned":0,"totalWastedBytes":0,"groups":0}\n\n`
      );
      return new Response(body, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }
    return NextResponse.json({ groups: [], totalWastedBytes: 0, filesScanned: 0 });
  }

  if (!isStream && cachedResult && Date.now() - cacheTs < CACHE_TTL) {
    return NextResponse.json(cachedResult);
  }

  const encoder = new TextEncoder();

  if (!isStream) {
    const { allFiles, sizeGroups } = buildFileList(envDirs);
    const groups: DupeGroup[] = [];
    let totalWastedBytes = 0;
    for (const sg of sizeGroups) {
      const byHash = new Map<string, typeof sg>();
      for (const f of sg) {
        const h = await partialHash(f.path);
        if (!h) continue;
        const arr = byHash.get(h);
        if (arr) arr.push(f);
        else byHash.set(h, [f]);
      }
      for (const dupes of byHash.values()) {
        if (dupes.length < 2) continue;
        const sorted = [...dupes].sort((a, b) => keepScore(a.path) - keepScore(b.path));
        const keep = sorted[0];
        const remove = sorted.slice(1);
        const wasted = keep.sizeBytes * remove.length;
        totalWastedBytes += wasted;
        groups.push({
          hash: (await partialHash(keep.path)).split(":")[1] || "",
          sizeBytes: keep.sizeBytes,
          keepPath: keep.path,
          removePaths: remove.map((r) => r.path),
          wastedBytes: wasted,
        });
      }
    }
    groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
    const result: ScanResult = { groups, totalWastedBytes, filesScanned: allFiles.length };
    cachedResult = result;
    cacheTs = Date.now();
    return NextResponse.json(result);
  }

  // ── Streaming mode — async with explicit yields for real-time flushing ────────
  const stream = new ReadableStream({
    async start(controller) {
      const send = async (obj: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        await yieldToEventLoop();
      };

      try {
        const { allFiles, sizeGroups, candidateCount } = buildFileList(envDirs);
        await send({ type: "scan", filesFound: allFiles.length, candidates: candidateCount });

        let hashed = 0;
        let lastPct = -1;
        const allGroups: DupeGroup[] = [];
        let totalWastedBytes = 0;

        // Progress updates every 1% or every 20 files (whichever is more frequent)
        let filesSinceLastYield = 0;

        for (const sg of sizeGroups) {
          const byHash = new Map<string, typeof sg>();
          for (const f of sg) {
            const h = await partialHash(f.path);
            hashed++;
            filesSinceLastYield++;

            const pct = candidateCount > 0 ? Math.floor((hashed / candidateCount) * 100) : 0;
            const fileName = f.path.replace(/\\/g, "/").split("/").pop() || f.path;

            if (pct !== lastPct || filesSinceLastYield >= 20) {
              lastPct = pct;
              filesSinceLastYield = 0;
              await send({ type: "progress", hashed, total: candidateCount, pct, currentFile: fileName });
            }

            if (!h) continue;
            const arr = byHash.get(h);
            if (arr) arr.push(f);
            else byHash.set(h, [f]);
          }

          for (const dupes of byHash.values()) {
            if (dupes.length < 2) continue;
            const sorted = [...dupes].sort((a, b) => keepScore(a.path) - keepScore(b.path));
            const keep = sorted[0];
            const remove = sorted.slice(1);
            const wasted = keep.sizeBytes * remove.length;
            totalWastedBytes += wasted;
            const group: DupeGroup = {
              hash: (await partialHash(keep.path)).split(":")[1] || "",
              sizeBytes: keep.sizeBytes,
              keepPath: keep.path,
              removePaths: remove.map((r) => r.path),
              wastedBytes: wasted,
            };
            allGroups.push(group);
            await send({ type: "group", group });
          }
        }

        allGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);
        cachedResult = { groups: allGroups, totalWastedBytes, filesScanned: allFiles.length };
        cacheTs = Date.now();

        await send({
          type: "complete",
          filesScanned: allFiles.length,
          totalWastedBytes,
          groups: allGroups.length,
        });
      } catch (err) {
        await send({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
