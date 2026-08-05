/**
 * Marca BOXY® — os ARQUIVOS oficiais, servidos como arquivo.
 *
 * Regra dura, e ela já foi quebrada uma vez aqui: **logo não se redesenha**. A
 * primeira versão deste componente compunha o símbolo na mão (um `<rect>` com
 * raio que eu escolhi + a estrela transladada e escalada por mim até "bater").
 * Bater no olho não é a marca: qualquer raio, respiro ou proporção que eu chute
 * cria uma variante não-autorizada que depois vaza para peça impressa.
 *
 * Então aqui nada é vetor inline. São os arquivos de `Z:\BOXY\@LOGO BOXY`,
 * copiados byte a byte para `public/brand/` e referenciados por caminho:
 *   - símbolo  → `logo-boxy-icon.png`            → /brand/boxy-symbol.png
 *   - logotipo → `BOXY MIN LOGOTYPE GREY.svg`    → /brand/boxy-logotype-sage.svg
 *
 * O logotipo Sage é o corte oficial para fundo escuro (é o arquivo que a marca
 * entrega nessa cor, #D7DFC6) — não é o verde recolorido. Isso também mantém o
 * verde da BOXY reservado para AÇÃO na interface, que é o que o guideline pede.
 *
 * Trocar a marca = trocar o arquivo em `public/brand/`. Nenhum código muda.
 *
 * SSoT: brand guideline 69e8e78b51a13978c9bc90d8 · docs/PLAN-branding-boxy.md
 */

/* eslint-disable @next/next/no-img-element */

/**
 * Símbolo. Sempre `w-auto`: o arquivo NÃO é quadrado (574×481, aspect 1.19),
 * porque traz o ® ao lado do quadrado. Forçar `w-7 h-7` encolhia o quadrado
 * para caber com o ® e deixava um cisco verde flutuando no canto.
 */
export function BoxySymbol({ className = "h-7" }: { className?: string }) {
  return (
    <img
      src="/brand/boxy-symbol.png"
      alt="BOXY®"
      className={`${className} w-auto object-contain`}
      draggable={false}
    />
  );
}

/**
 * Logotipo. O arquivo verde é o corte PRINCIPAL da marca — o "MIN LOGOTYPE" é
 * um corte mais leve, e a 16px as hastes finas dele somem no fundo escuro.
 */
export function BoxyWordmark({ className = "h-4" }: { className?: string }) {
  return (
    <img
      src="/brand/boxy-logotype-green.svg"
      alt="BOXY®"
      className={`${className} w-auto object-contain`}
      draggable={false}
    />
  );
}

/**
 * Lockup do header: símbolo + logotipo + descritor do produto.
 *
 * O descritor ("Store") vem num peso e numa cor abaixo do logotipo porque ele
 * NÃO é a marca — é onde você está dentro dela. Antes os dois vinham no mesmo
 * peso, e "Boxy Store" lia como se a marca fosse essa.
 *
 * A altura do logotipo é h-4 (16px), não h-3: os vazados internos das letras (as
 * fendas que formam o B, o O e o X) caem para ~1px a 12px, serrilham, e a
 * palavra vira um borrão.
 */
export function BoxyMark({ label }: { label?: string }) {
  return (
    <span className="flex items-center gap-2">
      {/* Símbolo OU logotipo, nunca os dois: os dois arquivos trazem o ®, e
          lado a lado a marca registrada aparecia duas vezes em 120px. Estreito
          fica o símbolo (compacto); a partir de `sm` entra o logotipo. */}
      <BoxySymbol className="h-7 shrink-0 sm:hidden" />
      <BoxyWordmark className="h-4 shrink-0 hidden sm:block" />
      {label ? (
        <span className="hidden lg:block text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          {label}
        </span>
      ) : null}
    </span>
  );
}
