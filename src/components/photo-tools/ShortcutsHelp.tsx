"use client";

/**
 * ShortcutsHelp — cheatsheet de atalhos (abre com `?` ou pelo botão no header).
 * Ferramentas vêm do registry (SSoT) → nunca desatualiza. Skin Boxy (zinc/acc2).
 */
import { useEffect } from "react";
import { X, Keyboard } from "lucide-react";
import { PHOTO_TOOLS } from "@/components/photo-tools/registry";

function Row({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px] text-zinc-400">{desc}</span>
      <span className="flex items-center gap-1">
        {keys.map((k) => (
          <kbd key={k} className="min-w-[18px] text-center px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700/70 text-[10px] font-mono text-zinc-200">{k}</kbd>
        ))}
      </span>
    </div>
  );
}

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[min(460px,92vw)] rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Keyboard size={14} className="text-acc2" />
          <h2 className="text-sm font-medium text-zinc-100">Atalhos</h2>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"><X size={15} /></button>
        </div>

        <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Ferramentas</p>
            {PHOTO_TOOLS.filter((t) => t.shortcut).map((t) => (
              <Row key={t.id} desc={t.label} keys={[t.shortcut!]} />
            ))}
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Canvas</p>
              <Row desc="Mover (pan)" keys={["Espaço", "arraste"]} />
              <Row desc="Pan rápido" keys={["botão do meio"]} />
              <Row desc="Zoom" keys={["scroll"]} />
              <Row desc="Encaixar / 2×" keys={["duplo-clique"]} />
              <Row desc="Perspectiva da Luz" keys={["Ctrl"]} />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Edição</p>
              <Row desc="Desfazer" keys={["Ctrl", "Z"]} />
              <Row desc="Refazer" keys={["Ctrl", "⇧", "Z"]} />
              <Row desc="Fechar painel" keys={["Esc"]} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
