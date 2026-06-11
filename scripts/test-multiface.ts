/**
 * Testa o protocolo multi-face do render-server via TCP (replacements[]).
 * Usage: bun scripts/test-multiface.ts   (servidor já rodando na :4200)
 */
import * as net from "net";
import * as fs from "fs";
import * as path from "path";

const PORT = parseInt(process.env.RENDER_PORT || "4200");
const OUT = path.resolve(".tmp/e2e/box-tcp.png");

const job = JSON.stringify({
  psdPath: path.resolve("Z:/BOXY/Produtos/Isolated/BOX_ISOLATED.psd"),
  outputPath: OUT,
  replacements: [
    { smartObject: "L (Edite Aqui)*", artPath: path.resolve(".tmp/e2e/art-red.png") },
    { smartObject: "T (Edite Aqui)*", artPath: path.resolve(".tmp/e2e/art-green.png") },
    { smartObject: "R (Edite Aqui)*", artPath: path.resolve(".tmp/e2e/art-blue.png") },
  ],
  hideLayers: [],
  preview: 1200,
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const result = await new Promise<any>((resolve, reject) => {
  const sock = new net.Socket();
  let buf = "";
  sock.connect(PORT, "127.0.0.1", () => sock.write(job + "\n"));
  sock.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith("progress:")) {
        try {
          const ev = JSON.parse(line.slice(9));
          console.log(`  · [${ev.step}] ${ev.detail ?? ""}`);
        } catch {}
      } else if (line.startsWith("{")) {
        try { resolve(JSON.parse(line)); } catch { resolve({ error: "bad json" }); }
        sock.destroy();
      }
    }
  });
  sock.on("error", reject);
  setTimeout(() => { sock.destroy(); resolve({ error: "timeout" }); }, 90000);
});

console.log(`\nResult: ${JSON.stringify(result)}`);
if (result.error || !fs.existsSync(OUT)) {
  console.error("❌ multi-face render failed");
  process.exit(1);
}
console.log(`✅ wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
