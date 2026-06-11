/**
 * End-to-end render test — connects directly to render-server TCP socket.
 * Usage: bun scripts/test-render.ts
 * Run with server already started: npm run render (in another terminal)
 * OR: bun scripts/test-render.ts --spawn  to auto-start
 */
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";

const PSD   = path.resolve("Z:/BOXY/Produtos/AI Outdoor Tree/AI - Outdoor with Tree.psd");
const ART   = path.resolve(".tmp/compare/Business_Card_v01/art.png");
const OUT   = path.resolve(".tmp/test-e2e-render.png");
const PORT  = 4200;
const SPAWN = process.argv.includes("--spawn");

// ── 1. Optionally spawn render server ─────────────────────────────────────────
let srv: child_process.ChildProcess | null = null;
if (SPAWN) {
  console.log("Spawning render server...");
  srv = child_process.spawn("bun", ["scripts/render-server.ts"], {
    stdio: ["ignore", "pipe", "pipe"], detached: false
  });
  srv.stdout?.on("data", (d: Buffer) => process.stdout.write("[srv] " + d));
  srv.stderr?.on("data", (d: Buffer) => process.stderr.write("[srv!] " + d));

  // Wait for port to open
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const s = new net.Socket();
      s.connect(PORT, "127.0.0.1", () => { s.destroy(); clearInterval(interval); resolve(); });
      s.on("error", () => s.destroy());
    }, 400);
    setTimeout(() => { clearInterval(interval); resolve(); }, 20000);
  });
  console.log("Server ready.\n");
}

// ── 2. Build job JSON ─────────────────────────────────────────────────────────
if (!fs.existsSync(PSD)) { console.error("PSD not found:", PSD); process.exit(1); }
if (!fs.existsSync(ART)) { console.error("Art not found:", ART); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const job = JSON.stringify({
  psdPath: PSD,
  artPath: ART,
  outputPath: OUT,
  smartObject: "Design Here",
  hideLayers: [],
  preview: false,
});

// ── 3. Send & stream progress ─────────────────────────────────────────────────
console.log(`Sending job: ${path.basename(PSD)} + ${path.basename(ART)}`);
const events: {step:string; detail?:string}[] = [];

const finalResult = await new Promise<{ok?:boolean; error?:string; durationMs?:number}>((resolve, reject) => {
  const sock = new net.Socket();
  let buf = "";

  sock.connect(PORT, "127.0.0.1", () => { sock.write(job + "\n"); });

  sock.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith("progress:")) {
        try {
          const ev = JSON.parse(line.slice(9));
          events.push(ev);
          const icon = ev.step === "error" ? "❌" : ev.step === "warning" ? "⚠️" : "·";
          console.log(`  ${icon} [${ev.step}] ${ev.detail ?? ""}`);
        } catch {}
      } else if (line.startsWith("{")) {
        try { resolve(JSON.parse(line)); } catch { resolve({ error: "bad json" }); }
        sock.destroy();
      }
    }
  });

  sock.on("error", reject);
  sock.on("close", () => resolve({ error: "socket closed without result" }));
  setTimeout(() => { sock.destroy(); resolve({ error: "timeout" }); }, 60000);
});

console.log(`\nServer response: ${JSON.stringify(finalResult)}`);

// ── 4. Check output ───────────────────────────────────────────────────────────
if (finalResult.error) {
  console.error("❌ Render failed:", finalResult.error);
  srv?.kill(); process.exit(1);
}

if (!fs.existsSync(OUT)) {
  console.error("❌ Output file not written:", OUT);
  srv?.kill(); process.exit(1);
}

const pngSize = fs.statSync(OUT).size;
console.log(`Output: ${OUT} (${(pngSize/1024).toFixed(0)}KB)`);

// ── 5. Pixel inspection ────────────────────────────────────────────────────────
// SO "Design Here" at approx (886,290) in the 2972x1792 canvas
const { createCanvas, loadImage } = await import("canvas");
const img = await loadImage(OUT);
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext("2d");
ctx.drawImage(img, 0, 0);

console.log(`\nCanvas: ${img.width}x${img.height}`);
console.log("Sampling SO region (Design Here ≈ 886,290 size 1453x1150):");

const soLeft=886, soTop=290, soW=1453, soH=1150;
let whiteCount = 0, total = 0;
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    const x = Math.floor(soLeft + soW*(col+1)/4);
    const y = Math.floor(soTop + soH*(row+1)/4);
    const [r,g,b,a] = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
    const white = r>230 && g>230 && b>230;
    console.log(`  (${x},${y}): ${hex} a=${a} ${white ? "⬜ white" : "🎨 color"}`);
    if (white) whiteCount++;
    total++;
  }
}

const pct = Math.round((1 - whiteCount/total)*100);
console.log(`\n${total - whiteCount}/${total} colored (${pct}%)`);
if (whiteCount >= 7) {
  console.log("❌ SO area mostly white — warp still failing");
} else if (whiteCount >= 4) {
  console.log("⚠️  Partial — some color, some white");
} else {
  console.log("✅ SO has color — art rendered!");
}

srv?.kill();
