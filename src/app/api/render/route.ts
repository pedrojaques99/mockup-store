import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink, readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { createConnection } from "net";

const TMP_DIR = join(process.cwd(), ".tmp", "renders");
// RENDER_ENGINE=photoshop → port 4201 (ps-render-server, pixel-perfect layer styles)
// RENDER_ENGINE=agpsd     → port 4200 (render-server, fast ag-psd compositor)
// default: agpsd
const RENDER_ENGINE = process.env.RENDER_ENGINE ?? "agpsd";
const RENDER_PORT = RENDER_ENGINE === "photoshop"
  ? parseInt(process.env.PS_RENDER_PORT || "4201")
  : parseInt(process.env.RENDER_PORT || "4200");
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_RENDERS || "3");
const TIMEOUT = parseInt(process.env.RENDER_TIMEOUT_MS || "120000");
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min auto-cleanup

let activeRenders = 0;

// Auto-cleanup old renders every 10 min
setInterval(async () => {
  try {
    if (!existsSync(TMP_DIR)) return;
    const dirs = await readdir(TMP_DIR);
    const now = Date.now();
    for (const dir of dirs) {
      const dirPath = join(TMP_DIR, dir);
      try {
        const s = await stat(dirPath);
        if (now - s.mtimeMs > CACHE_TTL_MS) {
          const files = await readdir(dirPath);
          for (const f of files) await unlink(join(dirPath, f)).catch(() => {});
          await unlink(dirPath).catch(() => {});
        }
      } catch {}
    }
  } catch {}
}, 10 * 60 * 1000);

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId || jobId.includes("..") || jobId.includes("/")) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }

  const outputPath = join(TMP_DIR, jobId, "output.png");
  if (!existsSync(outputPath)) {
    return NextResponse.json({ error: "Render not found or expired" }, { status: 404 });
  }

  const buf = await readFile(outputPath);
  // Preview renders are JPEG bytes even though the job file is named output.png
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const ext = isJpeg ? "jpg" : "png";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": isJpeg ? "image/jpeg" : "image/png",
      "Cache-Control": "private, max-age=1800",
      "Content-Disposition": `inline; filename="render-${jobId.slice(0, 8)}.${ext}"`,
    },
  });
}

export async function POST(req: NextRequest) {
  if (activeRenders >= MAX_CONCURRENT) {
    return NextResponse.json(
      { error: "Too many concurrent renders, try again shortly" },
      { status: 429 }
    );
  }

  /* `req.json()` fora de try/catch derrubava o handler ANTES de qualquer
   * `NextResponse.json`, e o 500 do Next sai com corpo VAZIO. O cliente então
   * estourava no próprio `res.json()` e mostrava "SyntaxError: Unexpected end of
   * JSON input" — a mensagem do parser, não a do problema.
   *
   * O corpo chega cortado quando passa do `middlewareClientMaxBodySize`
   * (next.config.ts): o Next trunca o clone em silêncio. Se o teto voltar a ser
   * baixo demais para alguma arte, o usuário lê o motivo em vez do sintoma. */
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error:
          "A arte não chegou inteira ao servidor (corpo da requisição truncado). Reduza a resolução da arte ou renderize menos faces por vez.",
      },
      { status: 413 },
    );
  }
  const { psdPath, artBase64, smartObject = "Your design", hideLayers = [] } = body as {
    psdPath?: string; artBase64?: string; smartObject?: string; hideLayers?: string[];
    colors?: Record<string, string>;
  };
  const stream = body.stream === true;
  const preview = body.preview === true;
  // Cor sólida por camada: { [path da camada]: "#rrggbb" }. Só hex de 6 dígitos
  // passa — o valor vai direto pro `fillStyle` do canvas no render-server, e
  // string arbitrária ali é o começo de uma superfície de injeção.
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.colors ?? {})) {
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim())) colors[k] = v.trim();
  }

  // Multi-face: arts = [{ smartObject, artBase64 }]. Legado: artBase64 + smartObject soltos.
  const arts: Array<{ smartObject?: string; artBase64: string }> =
    Array.isArray(body.arts) && body.arts.length > 0
      ? body.arts
      : artBase64
        ? [{ smartObject, artBase64 }]
        : [];

  if (!psdPath || arts.length === 0 || arts.some((a) => typeof a.artBase64 !== "string")) {
    return NextResponse.json({ error: "psdPath and artBase64 (or arts[]) required" }, { status: 400 });
  }

  if (!existsSync(psdPath)) {
    return NextResponse.json({ error: `PSD not found: ${psdPath}` }, { status: 404 });
  }

  const jobId = randomUUID();
  const jobDir = join(TMP_DIR, jobId);
  await mkdir(jobDir, { recursive: true });

  const outputPath = join(jobDir, "output.png");
  const replacements: Array<{ smartObject?: string; artPath: string }> = [];
  for (const [i, art] of arts.entries()) {
    const buf = Buffer.from(art.artBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const path = join(jobDir, `art-${i}.png`);
    await writeFile(path, buf);
    replacements.push({ smartObject: art.smartObject || smartObject, artPath: path });
  }
  // Campos legados (artPath/smartObject) seguem no job pro ps-render-server (single-art)
  const artPath = replacements[0].artPath;

  if (stream) {
    return streamRender({ psdPath, artPath, replacements, outputPath, smartObject, hideLayers, preview, jobId, colors });
  }

  activeRenders++;
  const start = Date.now();

  try {
    const result = await sendToRenderServer({ psdPath, artPath, replacements, outputPath, smartObject, hideLayers, preview, colors });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (!existsSync(outputPath)) {
      return NextResponse.json({ error: "Render produced no output" }, { status: 500 });
    }

    const png = await readFile(outputPath);
    const durationMs = Date.now() - start;

    return new NextResponse(png, {
      headers: {
        "Content-Type": "image/png",
        "X-Render-Duration-Ms": String(durationMs),
        "X-Job-Id": jobId,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Render failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    activeRenders--;
  }
}

function streamRender(job: {
  psdPath: string; artPath: string; outputPath: string;
  replacements: Array<{ smartObject?: string; artPath: string }>;
  smartObject: string; hideLayers: string[]; preview: boolean; jobId: string;
  colors?: Record<string, string>;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      activeRenders++;
      const socket = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
      let data = "";
      const timer = setTimeout(() => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step: "error", detail: "Timeout" })}\n\n`));
        controller.close();
        socket.destroy();
        activeRenders--;
      }, TIMEOUT);

      socket.on("connect", () => {
        socket.write(JSON.stringify({
          psdPath: job.psdPath,
          artPath: job.artPath,
          replacements: job.replacements,
          outputPath: job.outputPath,
          smartObject: job.smartObject,
          hideLayers: job.hideLayers,
          preview: job.preview,
        }) + "\n");
      });

      socket.on("data", (chunk) => {
        data += chunk.toString();
        let nlIdx: number;
        while ((nlIdx = data.indexOf("\n")) !== -1) {
          const line = data.slice(0, nlIdx);
          data = data.slice(nlIdx + 1);

          if (line.startsWith("progress:")) {
            const progress = line.slice("progress:".length);
            controller.enqueue(encoder.encode(`data: ${progress}\n\n`));
          } else {
            try {
              const result = JSON.parse(line);
              if (result.ok) {
                // Send complete with jobId — frontend fetches image via GET /api/render?jobId=xxx
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ step: "complete", durationMs: result.durationMs, jobId: job.jobId, sizeBytes: result.sizeBytes })}\n\n`
                ));
              } else if (result.error) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ step: "error", detail: result.error })}\n\n`
                ));
              }
            } catch {}
          }
        }
      });

      socket.on("end", () => {
        clearTimeout(timer);
        activeRenders--;
        controller.close();
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        activeRenders--;
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ step: "error", detail: err.message })}\n\n`
        ));
        controller.close();
      });
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Job-Id": job.jobId,
    },
  });
}

function sendToRenderServer(job: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Render timeout"));
    }, TIMEOUT);

    socket.on("connect", () => {
      socket.write(JSON.stringify(job) + "\n");
    });
    socket.on("data", (chunk) => {
      data += chunk.toString();
    });
    socket.on("end", () => {
      clearTimeout(timer);
      const lines = data.split("\n").filter(Boolean);
      const last = lines[lines.length - 1];
      try { resolve(JSON.parse(last)); }
      catch { reject(new Error("Invalid response from render server")); }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Render server unavailable: ${err.message}`));
    });
  });
}
