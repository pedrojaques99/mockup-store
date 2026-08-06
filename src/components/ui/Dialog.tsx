"use client";

/**
 * Dialog — Radix (foco preso, ESC, `aria-modal`, rolagem do fundo travada,
 * restauração do foco ao fechar), pele da casa.
 *
 * Existe porque o app tinha **doze modais escritos à mão** com `fixed inset-0` e
 * nenhum focus trap ou scroll lock em lugar nenhum do projeto — nove deles sem
 * `role="dialog"` nem `aria-modal`. Consequência concreta: abrir a Sessão ou os
 * Logs e apertar Tab jogava o foco para o grid ATRÁS do modal, o leitor de tela
 * nunca era avisado de que havia um diálogo, e a página de trás rolava por baixo.
 * Isso é correção de comportamento, não estilo — e é exatamente a classe de coisa
 * que não se escreve à mão.
 *
 * Duas peles, porque o app tem dois contextos: `neutral` (loja) e `zinc` (editor).
 */
import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

export function DialogContent({
  children,
  className,
  title,
  description,
  skin = "neutral",
  /** Diálogos de tela cheia (folhas de revisão) dispensam o cartão centrado. */
  bare = false,
  showClose = true,
  onEscapeKeyDown,
  onPointerDownOutside,
}: {
  children: React.ReactNode;
  className?: string;
  /** Nome acessível — OBRIGATÓRIO. Passe `srOnlyTitle` no visual se não quiser vê-lo. */
  title: string;
  description?: string;
  skin?: "neutral" | "zinc";
  bare?: boolean;
  showClose?: boolean;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  onPointerDownOutside?: RD.DialogContentProps["onPointerDownOutside"];
}) {
  const surface =
    skin === "zinc"
      ? "border-neutral-700/70 bg-neutral-900"
      : "border-neutral-800 bg-neutral-950";

  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
      <RD.Content
        onEscapeKeyDown={onEscapeKeyDown}
        onPointerDownOutside={onPointerDownOutside}
        className={cn(
          "fixed z-[95] outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out",
          bare
            ? "inset-0"
            : cn("left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,92vw)] max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl", surface),
          className,
        )}
      >
        {/* O Radix exige um Title para o nome acessível. Quando o cabeçalho visual
            já existe no `children`, este fica só para leitor de tela. */}
        <RD.Title className="sr-only">{title}</RD.Title>
        {description ? <RD.Description className="sr-only">{description}</RD.Description> : null}
        {children}
        {showClose && !bare && (
          <RD.Close
            aria-label="Fechar"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </RD.Close>
        )}
      </RD.Content>
    </RD.Portal>
  );
}
