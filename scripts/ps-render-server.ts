/**
 * Photoshop COM render server — pixel-perfect layer style fidelity.
 * Same TCP interface as render-server.ts (port 4200) but uses Photoshop.Application
 * via PowerShell COM to composite, preserving all layer effects (drop shadow,
 * bevel/emboss, inner glow, gradients) that ag-psd's canvas compositor drops.
 *
 * Requires: Photoshop installed (any 2020+ version), Windows only.
 * Run: bun scripts/ps-render-server.ts
 * Port: PS_RENDER_PORT env var (default 4201)
 *
 * Art is pre-scaled by this server to the SO's internal PSB canvas dimensions
 * (pl.width × pl.height) before calling replaceContents, so the art fills
 * the canvas exactly and Photoshop's own clipping masks handle the art area.
 */
import { readFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createServer } from "net";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { SO_TARGET as SO_PATTERNS, BRAND_HIDE } from "@visant/psd-engine";

const PORT = parseInt(process.env.PS_RENDER_PORT || "4201");
const JOB_TIMEOUT = parseInt(process.env.PS_JOB_TIMEOUT_MS || "180000");

let busy = false;
const queue: Array<{ json: string; socket: import("net").Socket }> = [];

// Verify Photoshop COM is available at startup
// Use classic Windows PowerShell 5.1 (powershell.exe) — pwsh.exe (PS7) may be blocked
// in some environments when spawned from Bun/Node.
const PS_EXE = "powershell.exe";

async function checkPhotoshop(): Promise<boolean> {
  return new Promise((res) => {
    const proc = spawn(PS_EXE, [
      "-NoProfile", "-NonInteractive", "-Command",
      `try { $a = New-Object -ComObject Photoshop.Application; "ok" } catch { "fail" }`
    ], { stdio: "pipe", timeout: 30_000 });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", () => res(out.trim() === "ok"));
    proc.on("error", () => res(false));
  });
}

console.log("[ps-render] Checking Photoshop COM availability...");
const psAvailable = await checkPhotoshop();
if (!psAvailable) {
  console.error("[ps-render] ERROR: Photoshop.Application COM not available. Is Photoshop installed?");
  process.exit(1);
}
console.log("[ps-render] Photoshop COM ready. Listening on port", PORT);

function drainQueue() {
  if (busy || queue.length === 0) return;
  const next = queue.shift()!;
  handleJob(next.json, next.socket);
}

function sendProgress(socket: import("net").Socket, step: string, detail?: string) {
  try {
    socket.write(`progress:${JSON.stringify({ step, detail, ts: Date.now() })}\n`);
  } catch {}
}

const server = createServer((socket) => {
  let data = "";
  socket.setTimeout(JOB_TIMEOUT + 15_000);
  socket.on("timeout", () => socket.end(JSON.stringify({ error: "Socket timeout" }) + "\n"));
  socket.on("error", (err) => console.log("[ps-render] Socket error:", err.message));
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
    console.log("[ps-render] Job timeout");
    try {
      socket.end(JSON.stringify({ error: "Job timeout" }) + "\n");
      socket.destroy();
    } catch {}
    busy = false;
    drainQueue();
  }, JOB_TIMEOUT);

  let fittedArtPath: string | null = null;

  try {
    const job = JSON.parse(json);
    const { psdPath, artPath, outputPath, smartObject = "", hideLayers = [] } = job;

    if (!psdPath || !artPath || !outputPath) {
      clearTimeout(timer);
      socket.end(JSON.stringify({ error: "Missing psdPath, artPath, or outputPath" }) + "\n");
      busy = false;
      drainQueue();
      return;
    }

    const psdName = psdPath.split(/[/\\]/).pop() ?? psdPath;

    // 1. Parse PSD metadata to find SO and internal canvas dims
    sendProgress(socket, "reading_psd", psdName);
    const agPsd = await import("ag-psd");
    const psdBuffer = readFileSync(resolve(psdPath));
    sendProgress(socket, "psd_loaded", `${(psdBuffer.length / 1e6).toFixed(0)}MB — ${elapsed()}`);

    sendProgress(socket, "parsing_psd", "ag-psd metadata...");
    const psdMeta = agPsd.readPsd(new Uint8Array(psdBuffer).buffer, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    sendProgress(socket, "psd_parsed", `${psdMeta.width}x${psdMeta.height} — ${elapsed()}`);

    const allLayers = flattenLayers((psdMeta.children as any[]) || []);
    const smartObjects = allLayers.filter((l: any) => l.placedLayer);

    // 2. Find target SO (same priority as render-server)
    const target: any =
      (smartObject && allLayers.find((l: any) => l.path === smartObject)) ||
      (smartObject && allLayers.find((l: any) => l.name === smartObject)) ||
      (smartObject && allLayers.find((l: any) => l.path?.toLowerCase().includes(smartObject.toLowerCase()))) ||
      (smartObject && allLayers.find((l: any) => l.name?.toLowerCase().includes(smartObject.toLowerCase()))) ||
      (smartObjects.length === 1 ? smartObjects[0] : null) ||
      allLayers.find((l: any) => SO_PATTERNS.test(l.name || "")) ||
      (smartObjects.length > 1
        ? smartObjects.reduce((a: any, b: any) => {
            const aA = (a.right - a.left) * (a.bottom - a.top);
            const aB = (b.right - b.left) * (b.bottom - b.top);
            return aB > aA ? b : a;
          })
        : smartObjects[0] ?? null);

    if (!target) {
      sendProgress(socket, "warning", `No smart object found for "${smartObject}" — available: ${allLayers.map((l: any) => l.name).filter(Boolean).slice(0, 15).join(", ")}`);
    }

    const pl = target?.placedLayer ?? {};
    const innerW: number = pl.width || (target ? target.right - target.left : 1000);
    const innerH: number = pl.height || (target ? target.bottom - target.top : 1000);
    sendProgress(socket, "smart_objects_found", target
      ? `"${target.name}" internal:${innerW}x${innerH}`
      : `0 — no SO found`);

    // 3. Cover-crop art to SO internal canvas dimensions
    sendProgress(socket, "reading_art", artPath.split(/[/\\]/).pop());
    const sharp = (await import("sharp")).default;
    const rawArt = readFileSync(resolve(artPath));
    const meta = await sharp(rawArt).metadata();
    sendProgress(socket, "art_ok", `${meta.width}x${meta.height} → fitting to ${innerW}x${innerH}`);

    fittedArtPath = join(tmpdir(), `ps-art-${randomUUID()}.png`);
    await sharp(rawArt)
      .resize(innerW, innerH, { fit: "cover", position: "center" })
      .png()
      .toFile(fittedArtPath);
    sendProgress(socket, "art_ready", elapsed());

    // 4. Build hide list: explicit + BRAND_HIDE auto-detect
    const autoHide = allLayers
      .filter((l: any) => BRAND_HIDE.test(l.name || ""))
      .map((l: any) => l.name as string)
      .filter(Boolean);
    const allHide = [...new Set([...(hideLayers as string[]), ...autoHide])];

    // 5. Run Photoshop via PowerShell COM
    sendProgress(socket, "rendering", "Photoshop COM...");
    const jsx = buildJsx({
      psdPath,
      artPath: fittedArtPath,
      outputPath,
      soName: target?.name ?? "",
      hideLayers: allHide,
    });

    const psResult = await runPowerShell(jsx);
    sendProgress(socket, "composited", `PS: ${psResult} — ${elapsed()}`);

    if (!existsSync(outputPath)) {
      throw new Error(`Photoshop did not produce output at ${outputPath}`);
    }

    const outBuffer = readFileSync(outputPath);
    const ms = Date.now() - start;
    console.log(`[ps-render] Done in ${ms}ms: ${psdName}`);
    sendProgress(socket, "done", `${(ms / 1000).toFixed(1)}s — ${(outBuffer.length / 1e6).toFixed(1)}MB`);
    clearTimeout(timer);
    socket.end(JSON.stringify({ ok: true, durationMs: ms, sizeBytes: outBuffer.length }) + "\n");
  } catch (err: any) {
    console.error("[ps-render] Error:", err.message);
    clearTimeout(timer);
    try {
      sendProgress(socket, "error", err.message);
      socket.end(JSON.stringify({ error: err.message }) + "\n");
    } catch {}
  } finally {
    if (fittedArtPath) {
      try { unlinkSync(fittedArtPath); } catch {}
    }
    busy = false;
    drainQueue();
  }
}

function flattenLayers(layers: any[], parentPath = ""): any[] {
  const result: any[] = [];
  for (const layer of layers) {
    const currentPath = parentPath
      ? `${parentPath} > ${layer.name ?? "unnamed"}`
      : (layer.name ?? "unnamed");
    result.push({ ...layer, path: currentPath });
    if (layer.children) result.push(...flattenLayers(layer.children, currentPath));
  }
  return result;
}

function buildJsx(opts: {
  psdPath: string;
  artPath: string;
  outputPath: string;
  soName: string;
  hideLayers: string[];
}): string {
  const psdJs = opts.psdPath.replace(/\\/g, "/");
  const artJs = opts.artPath.replace(/\\/g, "/");
  const outJs = opts.outputPath.replace(/\\/g, "/");
  // Safe JSON string for embed in JSX string (no JSX injection)
  const soNameJs = JSON.stringify(opts.soName);

  const hideCode = opts.hideLayers
    .map((n) => `  walkAll(doc.layers, function(l){ if (l.name === ${JSON.stringify(n)}) { try { l.visible = false; } catch(e){} } });`)
    .join("\n");

  return `(function(){
  var _prevUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  var doc = app.open(new File("${psdJs}"));
  function walkAll(ls, fn){ for (var i = 0; i < ls.length; i++){ fn(ls[i]); if (ls[i].typename === 'LayerSet') walkAll(ls[i].layers, fn); } }
  function isSO(l){ try { return l.typename !== 'LayerSet' && l.kind == LayerKind.SMARTOBJECT; } catch(e){ return false; } }

  // Hide watermark/branding layers
${hideCode}

  // Find target SO by exact name
  var target = null;
  if (${soNameJs}) {
    walkAll(doc.layers, function(l){ if (!target && isSO(l) && l.name === ${soNameJs}) target = l; });
    // Fallback: partial name match
    if (!target) walkAll(doc.layers, function(l){ if (!target && isSO(l) && l.name.toLowerCase().indexOf(${soNameJs}.toLowerCase()) !== -1) target = l; });
  }
  // Fallback: known BOXY/generic SO name patterns
  if (!target) walkAll(doc.layers, function(l){ if (!target && isSO(l) && /edite|edit.*aqui|design.here|place.here|your.design|double.click|artwork/i.test(l.name)) target = l; });

  var replaced = false;
  if (target) {
    doc.activeLayer = target;
    var d = new ActionDescriptor();
    d.putPath(charIDToTypeID('null'), new File("${artJs}"));
    executeAction(stringIDToTypeID('placedLayerReplaceContents'), d, DialogModes.NO);
    replaced = true;
  }

  var dup = doc.duplicate();
  dup.flatten();
  dup.saveAs(new File("${outJs}"), new PNGSaveOptions(), true, Extension.LOWERCASE);
  dup.close(SaveOptions.DONOTSAVECHANGES);
  doc.close(SaveOptions.DONOTSAVECHANGES);
  app.preferences.rulerUnits = _prevUnits;
  return replaced ? "replaced:" + target.name : "warn:SO not found";
})();`;
}

function runPowerShell(jsx: string): Promise<string> {
  return new Promise((res, rej) => {
    // Pass JSX as a PowerShell here-string to avoid escaping issues
    const script = `
$app = New-Object -ComObject Photoshop.Application
$app.DisplayDialogs = 3
$jsx = @'
${jsx}
'@
$result = $app.DoJavaScript($jsx)
Write-Output $result
`;
    const proc = spawn(
      PS_EXE,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: "pipe", timeout: JOB_TIMEOUT }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) res(stdout.trim());
      else rej(new Error(`PowerShell exit ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on("error", (err) => rej(err));
  });
}

server.listen(PORT, "127.0.0.1");
