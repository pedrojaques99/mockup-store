"use client";

/**
 * AuthChip — botão "Sign in with Visant" / chip do user logado.
 *
 * Lê /api/auth/me. Quando deslogado, abre `/api/auth/visant/login?returnTo=…` no
 * mesmo tab (redirect OAuth completo). Quando logado, mostra nome+inicial e
 * dropdown com logout. Plug no header dos editores; quando o boxy adicionar
 * `VisantProvider` no NextAuth, este componente continua funcionando.
 *
 * Cinza, não violeta. O botão era `bg-violet-600` — a cor da Visant — e virava a
 * coisa mais forte da tela, competindo com o verde BOXY, que é a única cor de
 * ação da casa. Login não é a ação principal de nenhuma destas telas: é como
 * você entra, não o que você veio fazer. Em cinza ele fica disponível sem
 * gritar, e o verde continua significando "clique aqui".
 */
import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, User } from "lucide-react";

interface MeUser { id: string; email?: string; name?: string }

export function AuthChip({ compact }: { compact?: boolean } = {}) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.ok ? r.json() : { user: null }).then((j) => {
      setUser(j.user ?? null); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (loading) return <div className="w-7 h-7 rounded-full bg-zinc-800 animate-pulse" />;

  if (!user) {
    const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    return (
      <a href={`/api/auth/visant/login?returnTo=${encodeURIComponent(returnTo)}`}
        title="Entrar com a sua conta Visant"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] font-medium transition-colors">
        <LogIn size={12} /> {compact ? "" : "Entrar"} com Visant
      </a>
    );
  }

  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  const label = user.name || user.email || user.id.slice(0, 8);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} title={`Visant: ${label}`}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-800 transition-colors">
        <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-[11px] font-semibold flex items-center justify-center">{initial}</span>
        {!compact && <span className="text-[11px] text-zinc-300 max-w-[140px] truncate">{label}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl text-[12px]">
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-zinc-300"><User size={12} />{label}</div>
            {user.email && user.email !== label && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{user.email}</div>}
            <div className="text-[10px] text-zinc-600 mt-1 font-mono truncate">tenant: visant_{user.id.slice(0, 10)}</div>
          </div>
          <a href="/api/auth/visant/logout" className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300">
            <LogOut size={12} /> Sair
          </a>
        </div>
      )}
    </div>
  );
}
