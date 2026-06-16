import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import { createServer } from "net";
import {
  BRAND_HIDE,
  flattenLayers,
  replaceLinkedSmartObjects,
  composePsd,
  resolveSoTarget,
  preloadDisplacementMaps,
  applyHideRules,
} from "@visant/psd-engine";

const PORT = parseInt(process.env.RENDER_PORT || "4200");
const JOB_TIMEOUT = 90_000;

let engine: any = null;
let busy = false;
const queue: Array<{ json: string; socket: import("net").Socket }> = [];

async function warmEngine() {
  console.log("[render-server] Initializing ag-psd engine...");
  const agPsd = await import("ag-psd");
  const { createCanvas: cc } = await import("canvas");
  agPsd.initializeCanvas(cc);
  engine = agPsd;
  console.log("[render-server] ag-psd engine ready (no browser needed)");
}

await warmEngine();
console.log("[render-server] Listening on port", PORT);

function drainQueue() {
  if (busy || queue.length === 0) return;
  const next = queue.shift()!;
  handleJob(next.json, next.socket);
}

function sendProgress(socket: import("net").Socket, step: string, detail?: string) {
  try {
    socket.write(`progress:${JSON.stringify({ step, detail, ts: Date.now() })}\n`);
  } catch {}
  if (step === "warning" || step === "error") console.log(`[render] ${step}: ${detail ?? ""}`);
}

const server = createServer((socket) => {
  let data = "";

  socket.setTimeout(JOB_TIMEOUT + 10_000);
  socket.on("timeout", () => {
    console.log("[render-server] Socket timeout, closing");
    socket.end(JSON.stringify({ error: "Socket timeout" }) + "\n");
    socket.destroy();
  });

  socket.on("error", (err) => {
    console.log("[render-server] Socket error:", err.message);
  });

  socket.on("data", (chunk) => {
    data += chunk.toString();

    const nlIdx = data.indexOf("\n");
    if (nlIdx === -1) return;

    const json = data.slice(0, nlIdx);
    data = data.slice(nlIdx + 1);

    if (busy) {
      queue.push({ json, socket });
      sendProgress(socket, "queued", `Position ${queue.length}`);
    } else {
      handleJob(json, socket);
    }
  });
});

async function handleJob(json: string, socket: import("net").Socket) {
  busy = true;
  const start = Date.now();
  const elapsed = () => `${((Date.now() - start) / 1000).toFixed(1)}s`;

  const timer = setTimeout(() => {
    console.log("[render-server] Job timeout");
    try {
      socket.end(JSON.stringify({ error: "Job timeout" }) + "\n");
      socket.destroy();
    } catch {}
    busy = false;
    drainQueue();
  }, JOB_TIMEOUT);

  try {
    const job = JSON.parse(json);
    const { psdPath, artPath, outputPath, smartObject, hideLayers, preview } = job;
    const previewMaxPx = preview ? (typeof preview === "number" ? preview : 800) : 0;

    // Multi-face: replacements = [{ smartObject, artPath }]. Legado: campos soltos.
    const replacements: Array<{ smartObject?: string; artPath: string }> =
      Array.isArray(job.replacements) && job.replacements.length > 0
        ? job.replacements
        : artPath
          ? [{ smartObject, artPath }]
          : [];

    if (!psdPath || replacements.length === 0 || !outputPath) {
      clearTimeout(timer);
      socket.end(JSON.stringify({ error: "Missing psdPath, artPath/replacements, or outputPath" }) + "\n");
      busy = false;
      drainQueue();
      return;
    }

    const psdName = psdPath.split(/[/\\]/).pop();

    // 1. Read PSD
    sendProgress(socket, "reading_psd", psdName);
    const psdBuffer = readFileSync(resolve(psdPath));
    sendProgress(socket, "psd_loaded", `${(psdBuffer.length / 1e6).toFixed(0)}MB — ${elapsed()}`);

    // 2. Parse PSD
    sendProgress(socket, "parsing_psd", "ag-psd readPsd...");
    const psd = engine.readPsd(new Uint8Array(psdBuffer).buffer, { skipThumbnail: true });
    sendProgress(socket, "psd_parsed", `${psd.width}x${psd.height} — ${elapsed()}`);

    const sharp = (await import("sharp")).default;
    const { createCanvas, loadImage } = await import("canvas");

    // 3. Flatten layers + pre-load displacement maps (Smart Filter Displace)
    const allLayers = flattenLayers(psd.children || []);
    const smartObjects = allLayers.filter((l: any) => l.placedLayer);
    sendProgress(socket, "smart_objects_found",
      smartObjects.length
        ? `${smartObjects.length}: ${smartObjects.map((l: any) => `"${l.name}"`).join(", ")}`
        : "0 — will try name-based detection"
    );

    await preloadDisplacementMaps(
      allLayers, psdPath, createCanvas as any,
      { exists: existsSync, read: (p) => readFileSync(p), resolve, dirname, basename },
      (buf, opts) => engine.readPsd(buf, opts),
      (msg) => sendProgress(socket, "warning", msg)
    );

    // 4. For each slot: read/upscale art → replace SO
    const replacedNames = new Set<string>();
    for (const slot of replacements) {
      sendProgress(socket, "reading_art", slot.artPath.split(/[/\\]/).pop());
      const rawArt = readFileSync(resolve(slot.artPath));

      const meta = await sharp(rawArt).metadata();
      const longest = Math.max(meta.width || 0, meta.height || 0);
      let artBuffer = rawArt;
      if (longest < 4000 && longest > 0) {
        const scale = Math.ceil(4000 / longest);
        const newW = (meta.width || 1) * scale;
        const newH = (meta.height || 1) * scale;
        sendProgress(socket, "upscaling_art", `${meta.width}x${meta.height} → ${newW}x${newH}`);
        artBuffer = await sharp(rawArt).resize(newW, newH, { fit: "fill" }).png().toBuffer();
      } else {
        sendProgress(socket, "art_ok", `${meta.width}x${meta.height}`);
      }
      sendProgress(socket, "art_ready", elapsed());

      const soName = slot.smartObject || smartObject || "Your design";
      sendProgress(socket, "finding_smart_objects", `Looking for "${soName}"`);
      const target = resolveSoTarget(allLayers, soName);

      if (!target) {
        sendProgress(socket, "warning", `Smart object "${soName}" not found — skipping slot`);
        sendProgress(socket, "available_layers",
          allLayers.map((l: any) => l.name).filter(Boolean).slice(0, 20).join(", ")
        );
        continue;
      }
      if (!target.placedLayer && replacedNames.has(target.name)) {
        sendProgress(socket, "warning", `"${target.name}" already replaced — skipping duplicate slot`);
        continue;
      }

      const artImg = await loadImage(artBuffer);
      sendProgress(socket, "replacing",
        `"${target.name}"${target.placedLayer?.id ? ` + linked (id ${String(target.placedLayer.id).slice(0, 8)})` : ""}`
      );

      const replaced = replaceLinkedSmartObjects(allLayers, target, artImg, createCanvas as any);
      for (const r of replaced) replacedNames.add(r.name);
      sendProgress(socket, "replaced",
        `${replaced.map((r) => `"${r.name}" ${r.width}x${r.height}${r.warped ? " warp" : ""}`).join(", ")} — ${elapsed()}`
      );
    }

    // 5. Hide layers: BRAND_HIDE watermarks + explicit list (engine SSOT)
    const hideNames = allLayers
      .filter((l: any) => (BRAND_HIDE.test(l.name || "") && !replacedNames.has(l.name)) || (hideLayers || []).includes(l.name))
      .map((l: any) => l.name).filter(Boolean);
    if (hideNames.length) sendProgress(socket, "hiding", `[${hideNames.join(", ")}]`);
    applyHideRules(allLayers, replacedNames, hideLayers || []);

    // 6. Composite
    sendProgress(socket, "rendering", "compositing layers...");
    let outW = psd.width, outH = psd.height;
    if (previewMaxPx > 0) {
      const scale = previewMaxPx / Math.max(outW, outH);
      if (scale < 1) { outW = Math.round(outW * scale); outH = Math.round(outH * scale); }
    }

    let fullCanvas: any;
    try {
      fullCanvas = composePsd(psd, createCanvas as any);
    } catch (composeErr: any) {
      throw new Error(`composePsd failed: ${composeErr?.message ?? composeErr}`);
    }

    let outCanvas = fullCanvas;
    if (previewMaxPx > 0 && (outW !== psd.width || outH !== psd.height)) {
      outCanvas = createCanvas(outW, outH);
      (outCanvas as any).getContext("2d").drawImage(fullCanvas, 0, 0, outW, outH);
    }
    sendProgress(socket, "composited", `${outW}x${outH} — ${elapsed()}`);

    // 7. Export
    sendProgress(socket, "exporting_png", previewMaxPx ? "Converting to JPEG..." : "Converting to PNG...");
    const outBuffer = previewMaxPx
      ? (outCanvas as any).toBuffer("image/jpeg", { quality: 0.75 })
      : (outCanvas as any).toBuffer("image/png");
    writeFileSync(resolve(outputPath), outBuffer);

    const ms = Date.now() - start;
    console.log(`[render-server] Done in ${ms}ms: ${psdName}`);
    sendProgress(socket, "done", `${(ms / 1000).toFixed(1)}s — ${(outBuffer.length / 1e6).toFixed(1)}MB`);
    clearTimeout(timer);
    socket.end(JSON.stringify({ ok: true, durationMs: ms, sizeBytes: outBuffer.length }) + "\n");
  } catch (err: any) {
    console.error("[render-server] Error:", err.message);
    clearTimeout(timer);
    try {
      sendProgress(socket, "error", err.message);
      socket.end(JSON.stringify({ error: err.message }) + "\n");
    } catch {}
  } finally {
    busy = false;
    drainQueue();
  }
}

server.listen(PORT, "127.0.0.1");
