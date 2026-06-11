import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createServer } from "net";
import {
  SO_TARGET as SO_PATTERNS,
  BRAND_HIDE,
  flattenLayers,
  replaceLinkedSmartObjects,
  composePsd,
} from "@visantlabs/psd-engine";

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
    const psdMB = (psdBuffer.length / 1e6).toFixed(0);
    sendProgress(socket, "psd_loaded", `${psdMB}MB — ${elapsed()}`);

    // 2. Parse PSD with ag-psd (renders to canvas)
    sendProgress(socket, "parsing_psd", "ag-psd readPsd...");
    const psd = engine.readPsd(new Uint8Array(psdBuffer).buffer, {
      skipThumbnail: true,
    });
    sendProgress(socket, "psd_parsed", `${psd.width}x${psd.height} — ${elapsed()}`);

    const sharp = (await import("sharp")).default;
    const { createCanvas, loadImage } = await import("canvas");

    // 3+4. Para cada slot: lê/upscala a arte e troca o smart object da face
    const allLayers = flattenLayers(psd.children || []);
    const smartObjects = allLayers.filter((l: any) => l.placedLayer);
    sendProgress(socket, "smart_objects_found",
      smartObjects.length
        ? `${smartObjects.length}: ${smartObjects.map((l: any) => `"${l.name}"`).join(", ")}`
        : "0 — will try name-based detection"
    );

    const byArea = (a: any, b: any) => {
      const areaA = (a.right - a.left) * (a.bottom - a.top);
      const areaB = (b.right - b.left) * (b.bottom - b.top);
      return areaB > areaA ? b : a;
    };

    // Priority: exact path → exact name → partial name/path → single SO → largest pattern-match → largest SO
    const findTarget = (soName: string) => {
      const patternMatches = smartObjects.filter((l: any) => SO_PATTERNS.test(l.name || ""));
      return (
        allLayers.find((l: any) => l.path === soName) ||
        allLayers.find((l: any) => l.name === soName) ||
        allLayers.find((l: any) => l.path?.toLowerCase().includes(soName.toLowerCase())) ||
        allLayers.find((l: any) => l.name?.toLowerCase().includes(soName.toLowerCase())) ||
        (smartObjects.length === 1 ? smartObjects[0] : null) ||
        (patternMatches.length ? patternMatches.reduce(byArea) : null) ||
        (smartObjects.length ? smartObjects.reduce(byArea) : null)
      );
    };

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
      const target = findTarget(soName);

      if (!target) {
        sendProgress(socket, "warning", `Smart object "${soName}" not found — skipping slot`);
        const names = allLayers.map((l: any) => l.name).filter(Boolean).slice(0, 20);
        sendProgress(socket, "available_layers", names.join(", "));
        continue;
      }
      if (!target.placedLayer && replacedNames.has(target.name)) {
        sendProgress(socket, "warning", `"${target.name}" already replaced — skipping duplicate slot`);
        continue;
      }

      const artImg = await loadImage(artBuffer);
      sendProgress(socket, "replacing", `"${target.name}"${target.placedLayer?.id ? ` + linked (id ${String(target.placedLayer.id).slice(0, 8)})` : ""}`);

      const replaced = replaceLinkedSmartObjects(allLayers, target, artImg, createCanvas);
      for (const r of replaced) replacedNames.add(r.name);
      sendProgress(socket, "replaced",
        `${replaced.map((r) => `"${r.name}" ${r.width}x${r.height}${r.warped ? " warp" : ""}`).join(", ")} — ${elapsed()}`
      );
    }

    // 5. Hide layers: explicit list + auto-hide branding/placeholder watermarks
    const allHide = new Set([...(hideLayers || [])]);

    for (const layer of allLayers) {
      if (BRAND_HIDE.test(layer.name || "")) {
        allHide.add(layer.name);
      }
    }
    // Never hide the SOs we just replaced with user art — names might match BRAND_HIDE
    for (const name of replacedNames) allHide.delete(name);

    if (allHide.size) {
      sendProgress(socket, "hiding", `[${[...allHide].join(", ")}]`);
    }

    for (const layerTarget of allHide) {
      const layer = allLayers.find((l: any) => l.path === layerTarget || l.name === layerTarget);
      if (layer?.__original) {
        layer.__original.hidden = true;
      }
    }

    // 6. Composite all layers bottom-to-top with blend modes, masks and clipping
    sendProgress(socket, "rendering", "compositing layers...");
    const { createCanvas: cc2 } = await import("canvas");

    let outW = psd.width, outH = psd.height;
    if (previewMaxPx > 0) {
      const scale = previewMaxPx / Math.max(outW, outH);
      if (scale < 1) { outW = Math.round(outW * scale); outH = Math.round(outH * scale); }
    }

    const fullCanvas = composePsd(psd, cc2);

    let outCanvas = fullCanvas;
    if (previewMaxPx > 0 && (outW !== psd.width || outH !== psd.height)) {
      outCanvas = cc2(outW, outH);
      outCanvas.getContext("2d").drawImage(fullCanvas, 0, 0, outW, outH);
    }
    sendProgress(socket, "composited", `${outW}x${outH} — ${elapsed()}`);

    // 7. Export (JPEG for preview, PNG for full)
    sendProgress(socket, "exporting_png", previewMaxPx ? "Converting to JPEG..." : "Converting to PNG...");
    const outBuffer = previewMaxPx
      ? outCanvas.toBuffer("image/jpeg", { quality: 0.75 })
      : outCanvas.toBuffer("image/png");
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
