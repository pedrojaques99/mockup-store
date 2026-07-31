"use client";

/**
 * LuzAssetModal — escolhe um asset de overlay para a camada ativa.
 * Galeria das pastas locais (via /api/overlays/list → thumbs em /api/local-image)
 * + upload manual. Skin Boxy (zinc/acc2).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { X, Upload, Loader2, Search } from "lucide-react";

interface OverlayItem {
  name: string;
  path: string;
  folder: string;
  sizeBytes: number;
}

export function LuzAssetModal({
  open,
  layerLabel,
  onClose,
  onPick,
  onUploadFile,
}: {
  open: boolean;
  layerLabel: string;
  onClose: () => void;
  /** Galeria: caminho de disco escolhido. */
  onPick: (path: string) => void;
  /** Upload: arquivo escolhido. */
  onUploadFile: (f: File) => void;
}) {
  const [items, setItems] = useState<OverlayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || items.length) return;
    setLoading(true);
    setErr("");
    fetch("/api/overlays/list")
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []))
      .catch((e) => setErr(e.message ?? "erro ao listar"))
      .finally(() => setLoading(false));
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.name.toLowerCase().includes(s)) : items;
  }, [items, q]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Escolher asset de luz" skin="zinc" showClose={false}
        className="w-[min(900px,92vw)] h-[min(640px,86vh)] max-h-[86vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-100">
            Importar overlay <span className="text-zinc-500">· {layerLabel}</span>
          </h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <Upload size={12} /> Upload
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              title="Fechar"
              className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Busca */}
        <div className="px-4 py-2 border-b border-zinc-800/60">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
            <Search size={13} className="text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome…"
              className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            <span className="text-[10px] text-zinc-600">{filtered.length}</span>
          </div>
        </div>

        {/* Galeria */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="h-full grid place-items-center text-zinc-500">
              <span className="flex items-center gap-2 text-sm">
                <Loader2 size={16} className="animate-spin text-acc" /> Lendo pastas…
              </span>
            </div>
          ) : err ? (
            <div className="h-full grid place-items-center text-center text-zinc-500 text-sm px-6">
              <div>
                <p className="text-red-400">{err}</p>
                <p className="text-[11px] text-zinc-600 mt-1">
                  Confira se as pastas de overlay estão acessíveis (Z: / Drive). Use Upload enquanto isso.
                </p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full grid place-items-center text-center text-zinc-500 text-sm px-6">
              <div>
                <p>Nenhum overlay encontrado.</p>
                <p className="text-[11px] text-zinc-600 mt-1">Use o botão Upload para subir um arquivo.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {filtered.map((it) => (
                <button
                  key={it.path}
                  type="button"
                  onClick={() => onPick(it.path)}
                  className="group rounded-lg overflow-hidden border border-zinc-800 hover:border-acc2 bg-zinc-950/60 transition-colors text-left"
                  title={it.name}
                >
                  <div className="aspect-square grid place-items-center bg-[conic-gradient(at_50%_50%,#27272a_25%,#18181b_0_50%,#27272a_0_75%,#18181b_0)] bg-[length:16px_16px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/local-image?path=${encodeURIComponent(it.path)}`}
                      alt={it.name}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <p className="px-1.5 py-1 text-[10px] text-zinc-400 truncate group-hover:text-zinc-200">
                    {it.name}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
