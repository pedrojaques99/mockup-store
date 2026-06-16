import { readFileSync, writeFileSync } from "fs";

const SRC = "Z:/BOXY/WEB/lottie/4b7fc2bc-1164-11ee-b175-e71b72094465.json";
const OUT = "Z:/BOXY/mockup-store/public/lottie/box-loader.json";

const data = JSON.parse(readFileSync(SRC, "utf8"));

// Emerald BOXY accent: #10b981
const EM = [0.063, 0.725, 0.506];

function walk(shapes, cb) {
  for (const s of shapes) {
    cb(s);
    if (s.it) walk(s.it, cb);
  }
}

// ── Layer 0: Shape Layer 1 → transforma em glow emerald pulsante ────────────
const glow = data.layers[0];

// remove stroke (ruído)
walk(glow.shapes, (s) => {
  if (s.ty === "st") s.w = { a: 0, k: 0, ix: 5 };
});

// muda gradiente para emerald translúcido
walk(glow.shapes, (s) => {
  if (s.ty === "gf") {
    s.g.p = 3;
    // 3 color stops (12 vals) + 3 alpha stops (6 vals)
    s.g.k.k = [
      0,   ...EM,         // centro: emerald
      0.5, ...EM,         // meio: emerald
      1,   0.024, 0.29, 0.20,  // borda: emerald escuro
      0, 0.55,            // alpha centro
      0.6, 0.20,          // alpha meio
      1, 0,               // alpha borda: 0
    ];
    // linear → muda para radial se possível (t:2)
    s.t = 2;
    // centraliza sobre o box
    s.s = { a: 0, k: [500, 500], ix: 5 };
    s.e = { a: 0, k: [500, 100], ix: 6 };
  }
});

// opacity pulsante mais suave (max 60%)
if (glow.ks.o.a === 1) {
  glow.ks.o.k = glow.ks.o.k.map((kf) => ({
    ...kf,
    s: kf.s ? [kf.s[0] * 0.6] : kf.s,
    e: kf.e ? [kf.e[0] * 0.6] : kf.e,
  }));
}

// ── Layer 1: "Layer 3" = topo do box (flutua) ────────────────────────────────
const boxTop = data.layers[1];
walk(boxTop.shapes, (s) => {
  if (s.ty === "fl") {
    const r = Array.isArray(s.c.k) ? s.c.k[0] : 0;
    if (r > 0.9)       s.c.k = [0.20, 0.20, 0.20, 1]; // face topo
    else if (r > 0.8)  s.c.k = [0.15, 0.15, 0.15, 1]; // face direita
    else               s.c.k = [0.10, 0.10, 0.10, 1]; // face esquerda
  }
});

// ── Layer 2: "Layer 2" = corpo do box ────────────────────────────────────────
const boxBody = data.layers[2];
walk(boxBody.shapes, (s) => {
  if (s.ty === "fl") {
    const r = Array.isArray(s.c.k) ? s.c.k[0] : 0;
    if (r > 0.25)      s.c.k = [...EM, 0.85]; // highlight → emerald accent
    else if (r > 0.15) s.c.k = [0.06, 0.06, 0.06, 1];
    else if (r > 0.08) s.c.k = [0.04, 0.04, 0.04, 1];
    else               s.c.k = [0.02, 0.02, 0.02, 1];
  }
});

// ── Layer 3: "Layer 4" = base/fundo do box ───────────────────────────────────
const boxBase = data.layers[3];
walk(boxBase.shapes, (s) => {
  if (s.ty === "fl") {
    const r = Array.isArray(s.c.k) ? s.c.k[0] : 0;
    if (r > 0.25)      s.c.k = [...EM, 0.4]; // base edge: emerald tênue
    else               s.c.k = [0.04, 0.04, 0.04, 1];
  }
});

writeFileSync(OUT, JSON.stringify(data));
console.log("✓ box-loader.json restyled → BOXY style");
