"use client";

/**
 * CalibrationPanel — painel "Superfície" do photo-mockup editor.
 *
 * Ponte SSoT com /calibrate: importa mesh + displacement + material + máscara
 * de uma cena calibrada, e permite enviar de volta. Os parâmetros vivem no
 * `DocState` (undo coberto) e são consumidos pelo /api/photo-mockup/[id]/render.
 *
 * Não duplica o editor de malha — exibe o estado e oferece atalho pra abrir o
 * /calibrate completo numa aba nova quando o usuário precisa esculpir.
 */
import { useEffect, useState } from "react";
import { Loader2, Download, Upload as UploadIcon, ExternalLink, CheckCircle2, Scan, Waves, Cpu } from "lucide-react";
import type { SceneAnalysis } from "@/lib/scene-classify";
import { useDocField, useEditorDoc } from "@/stores/editorDoc";
import { meshIsWarped } from "@/lib/mesh-core";
import { autoSmoothTangents, defaultMesh, ensureTangents } from "@/lib/mesh-core";
import type { Quad } from "@/stores/editorDoc";

const MATERIALS = [
  { id: "none", label: "—" }, { id: "fabric", label: "Tecido" }, { id: "metal", label: "Metal" },
  { id: "glass", label: "Vidro" }, { id: "worn", label: "Gasto" }, { id: "shadow", label: "Sombra" },
];

const quadToCorners = (q: Quad) => ({ tl: q.tl, tr: q.tr, br: q.br, bl: q.bl });

export function CalibrationPanel() {
  const [mesh, setMesh] = useDocField("mesh");
  const [dispScale, setDispScale] = useDocField("dispScale");
  const [dispBlur, setDispBlur] = useDocField("dispBlur");
  const [material, setMaterial] = useDocField("surfaceMaterial");
  const [matInt, setMatInt] = useDocField("surfaceMaterialIntensity");
  const [matAng, setMatAng] = useDocField("surfaceMaterialAngle");
  const [matScl, setMatScl] = useDocField("surfaceMaterialScale");
  const [link, setLink] = useDocField("calibrationKey");
  const [substrate, setSubstrateDoc] = useDocField("substrate");
  const [quad] = useDocField("quad");
  const setSurfaceMask = useEditorDoc((s) => s.setField);

  const [scene, setScene] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [cls, setCls] = useState<SceneAnalysis | null>(null);
  // Auto-classifica a cena alvo (debounce) — mostra o tipo de input pra dar contexto.
  useEffect(() => {
    if (!scene) { setCls(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/calibrate/classify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: scene, dir }),
        });
        if (!r.ok) { setCls(null); return; }
        setCls(await r.json() as SceneAnalysis);
      } catch { setCls(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [scene, dir]);

  const KIND_COLOR: Record<string, string> = {
    magenta: "text-fuchsia-300 bg-fuchsia-950/60 border-fuchsia-800",
    white: "text-zinc-100 bg-zinc-800 border-zinc-600",
    custom: "text-amber-300 bg-amber-950/60 border-amber-800",
  };
  const KIND_LABEL: Record<string, string> = { magenta: "Magenta", white: "White-label", custom: "Custom" };

  // Parse calibrationKey "dir::name" pra pré-popular inputs.
  if (link && !scene && !dir) {
    const [d, n] = link.split("::"); if (n) { setScene(n); setDir(d); }
  }

  const importFromCalibrate = async () => {
    if (!scene) { setErr("informe o nome da cena calibrada"); return; }
    setBusy("load"); setErr(null); setOkMsg(null);
    try {
      const u = new URL("/api/calibrate/load", window.location.origin);
      u.searchParams.set("name", scene);
      if (dir) u.searchParams.set("dir", dir);
      const r = await fetch(u.toString());
      const j = await r.json();
      if (!j.entry) { setErr("cena não calibrada, abra o /calibrate primeiro"); return; }
      const e = j.entry;
      if (e.mesh) setMesh(e.mesh);
      if (typeof e.dispScale === "number") setDispScale(e.dispScale);
      if (typeof e.dispBlur === "number") setDispBlur(e.dispBlur);
      if (e.material) setMaterial(e.material);
      if (typeof e.materialIntensity === "number") setMatInt(e.materialIntensity);
      if (typeof e.materialAngle === "number") setMatAng(e.materialAngle);
      if (typeof e.materialScale === "number") setMatScl(e.materialScale);
      // substrate (self-learning loop): persiste pra ir no payload do publish.
      if (typeof e.substrate === "string") setSubstrateDoc(e.substrate);
      if (j.surfaceMaskDataUrl) setSurfaceMask("surfaceMaskUrl", j.surfaceMaskDataUrl);
      setLink(`${dir}::${scene}`);
      setOkMsg("calibração importada");
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(null); }
  };

  const exportToCalibrate = async () => {
    if (!scene) { setErr("informe o nome da cena"); return; }
    if (!quad) { setErr("sem quad, defina os cantos primeiro"); return; }
    setBusy("save"); setErr(null); setOkMsg(null);
    try {
      const surfaceMaskBase64 = useEditorDoc.getState().doc.surfaceMaskUrl ?? undefined;
      const r = await fetch("/api/calibrate/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scene, dir,
          quad, mesh: mesh ?? undefined,
          dispScale, dispBlur,
          material, materialIntensity: matInt, materialAngle: matAng, materialScale: matScl,
          surfaceMaskBase64,
          substrate: substrate ?? undefined,
        }),
      });
      const j = await r.json();
      if (j.error) { setErr(j.error); return; }
      setLink(`${dir}::${scene}`); setOkMsg("calibração salva");
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(null); }
  };

  const openCalibrate = () => {
    const u = new URL("/calibrate", window.location.origin);
    window.open(u.toString(), "_blank", "noopener");
  };

  const ensureMesh = () => {
    if (!quad) { setErr("sem quad, defina os cantos primeiro"); return; }
    if (mesh) return;
    setMesh(ensureTangents(defaultMesh(quadToCorners(quad), 3, 3)));
  };
  const smoothMesh = () => { if (mesh) setMesh(autoSmoothTangents(mesh)); };
  const resetMesh = () => {
    if (!quad) return;
    setMesh(ensureTangents(defaultMesh(quadToCorners(quad), mesh?.rows ?? 3, mesh?.cols ?? 3)));
  };

  const meshWarped = mesh ? meshIsWarped(mesh) : false;

  return (
    <div className="text-xs space-y-3 w-[320px]">
      <header className="flex items-center justify-between">
        <h3 className="text-zinc-200 font-semibold">Superfície (calibração)</h3>
        {link && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} />vinculada</span>}
      </header>

      {/* link com cena calibrada */}
      <div className="space-y-1.5 p-2 rounded bg-zinc-900/60 border border-zinc-800">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Cena no /calibrate</div>
        <input value={scene} onChange={(e) => setScene(e.target.value)} placeholder="ex.: minha-cena.jpg"
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200" />
        <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="pasta (vazio = default)"
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-400 text-[11px]" />
        <div className="flex items-center gap-2">
          <button onClick={importFromCalibrate} disabled={busy !== null} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40">
            {busy === "load" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Importar
          </button>
          <button onClick={exportToCalibrate} disabled={busy !== null} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">
            {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <UploadIcon size={12} />} Salvar
          </button>
          <button onClick={openCalibrate} title="Abrir /calibrate completo" className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><ExternalLink size={13} /></button>
        </div>
        {err && <div className="text-red-400 text-[11px]">{err}</div>}
        {okMsg && <div className="text-emerald-400 text-[11px]">{okMsg}</div>}

        {cls && (
          <div className={["mt-1 flex flex-col gap-1 px-2 py-1.5 rounded border text-[11px]", KIND_COLOR[cls.placeholder.kind]].join(" ")}>
            <div className="flex items-center gap-2">
              <Cpu size={11} />
              <span className="font-semibold">{KIND_LABEL[cls.placeholder.kind]}</span>
              <span className="text-zinc-700">•</span>
              <span className="font-medium text-zinc-200">{cls.substrate.kind}</span>
              <span className="text-zinc-500">{(cls.substrate.confidence * 100).toFixed(0)}%</span>
              <button
                onClick={() => {
                  const p = cls.preset;
                  setDispScale(p.dispScale); setDispBlur(p.dispBlur);
                  setMaterial(p.material); setMatInt(p.materialIntensity);
                  setMatAng(p.materialAngle); setMatScl(p.materialScale);
                  setSubstrateDoc(cls.substrate.kind);
                  setOkMsg(`preset "${cls.substrate.kind}" aplicado`);
                }}
                className="ml-auto px-1.5 py-0.5 rounded bg-zinc-900/80 hover:bg-zinc-700 text-zinc-200"
                title={cls.placeholder.hint}
              >Aplicar preset</button>
            </div>
            {cls.ai && (
              <div className="flex items-center gap-1.5 text-purple-300">
                <Scan size={10} />
                <span className="truncate">{cls.ai.description}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* malha (warp envelope) */}
      <div className="space-y-1.5 p-2 rounded bg-zinc-900/60 border border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Malha (warp)</div>
          <span className={meshWarped ? "text-lime-400" : "text-zinc-600"}>{meshWarped ? "curvada" : "reta"}</span>
        </div>
        {!mesh && <button onClick={ensureMesh} className="w-full px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">criar malha 3×3</button>}
        {mesh && (
          <div className="flex items-center gap-1">
            <button onClick={smoothMesh} className="flex-1 px-2 py-1 rounded bg-lime-700 hover:bg-lime-600 text-white">Suavizar</button>
            <button onClick={resetMesh} className="flex-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">resetar</button>
            <button onClick={() => setMesh(null)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400">×</button>
          </div>
        )}
        <p className="text-[10px] text-zinc-600">Editor visual completo: abra o <button onClick={openCalibrate} className="underline">/calibrate</button> (hastes Bézier, multi-seleção, Ctrl/Alt).</p>
      </div>

      {/* displacement (relevo) */}
      <div className="space-y-2 p-2 rounded bg-zinc-900/60 border border-zinc-800">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Waves size={11} />Relevo (displacement)</div>
        <label className="flex items-center justify-between gap-2">amplitude
          <input type="range" min={0} max={20} step={1} value={dispScale} onChange={(e) => setDispScale(+e.target.value)} className="flex-1" />
          <span className="font-mono text-zinc-300 w-6 text-right">{dispScale}</span>
        </label>
        <label className="flex items-center justify-between gap-2">suavização
          <input type="range" min={0} max={30} step={1} value={dispBlur} onChange={(e) => setDispBlur(+e.target.value)} className="flex-1" />
          <span className="font-mono text-zinc-300 w-6 text-right">{dispBlur}</span>
        </label>
        <p className="text-[10px] text-zinc-600">Compõe automaticamente com a malha (macro + micro) no render.</p>
      </div>

      {/* material/substrato */}
      <div className="space-y-2 p-2 rounded bg-zinc-900/60 border border-zinc-800">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Substrato (material)</div>
        <div className="flex items-center gap-0.5 bg-zinc-950 rounded p-0.5 flex-wrap">
          {MATERIALS.map((m) => (
            <button key={m.id} onClick={() => setMaterial(m.id)}
              className={["px-2 py-1 rounded text-[11px] transition-ui", material === m.id ? "bg-fuchsia-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>{m.label}</button>
          ))}
        </div>
        <label className="flex items-center justify-between gap-2">força
          <input type="range" min={0} max={1} step={0.05} value={matInt} disabled={material === "none"} onChange={(e) => setMatInt(+e.target.value)} className="flex-1" />
          <span className="font-mono text-zinc-300 w-8 text-right">{matInt.toFixed(2)}</span>
        </label>
        <label className="flex items-center justify-between gap-2">ângulo
          <input type="range" min={0} max={180} step={5} value={matAng} disabled={material === "none"} onChange={(e) => setMatAng(+e.target.value)} className="flex-1" />
          <span className="font-mono text-zinc-300 w-8 text-right">{matAng}°</span>
        </label>
        <label className="flex items-center justify-between gap-2">escala
          <input type="range" min={2} max={20} step={1} value={matScl} disabled={material === "none"} onChange={(e) => setMatScl(+e.target.value)} className="flex-1" />
          <span className="font-mono text-zinc-300 w-6 text-right">{matScl}</span>
        </label>
      </div>
    </div>
  );
}
