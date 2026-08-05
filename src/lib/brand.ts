/**
 * SSoT de cor da marca BOXY® — a forma JS dos tokens que `globals.css` declara
 * em CSS (`--color-acc`, `--color-acc2`, `--color-ink`).
 *
 * Por que existe: canvas não aceita classe do Tailwind. `ctx.strokeStyle`,
 * `ctx.fillStyle` e `style={{ ... }}` só falam hex, então TODO tool de canvas
 * (Luz, Crop, Pen, Segment, Zoom) escrevia a cor na unha. Quando a marca virou
 * BOXY, os `bg-acc2` seguiram o token e esses literais NÃO — 11 pontos da tela
 * continuaram no verde e no ciano antigos, que não existem na paleta da BOXY.
 * A interface fica meio pintada e ninguém vê, porque cada literal está sozinho
 * no seu arquivo.
 *
 * ⚠️ Mudou aqui, muda no bloco `@theme` de `globals.css`. Os dois são espelho,
 * igual ao par `lib/motion.ts` ↔ `--ease-*`.
 *
 * Origem dos valores: `Z:\BOXY\@LOGO BOXY\SVG n PDF` e o gradiente `Rodapé.png`.
 * Guideline: 69e8e78b51a13978c9bc90d8 (Visant Labs).
 */

/** Verde BOXY. Ação primária, estado ativo, confirmado. Cor CLARA. */
export const ACC2 = "#bfff38";
export const ACC2_RGB = "191,255,56";

/** Verde-folha (meio do gradiente da casa). Transitório: em progresso, dica. */
export const ACC = "#84b028";
export const ACC_RGB = "132,176,40";

/** Sage. Texto de destaque sobre escuro. */
export const INK = "#d7dfc6";

/** Oliva escuro (fim do gradiente Rodapé). Contorno/sombra sobre os verdes. */
export const OLIVE = "#4d6617";

/** Ink Black. Fundo da marca e texto sobre qualquer verde. */
export const BLACK = "#161616";

/**
 * Cor de texto/traço a usar EM CIMA do verde da marca.
 *
 * Não é preferência: `#bfff38` tem luminância alta, então branco em cima dá
 * ~2.6:1 e reprova em qualquer critério. O guideline da BOXY fecha a questão na
 * seção de acessibilidade — sobre verde, texto quase-preto, sempre.
 */
export const ON_ACCENT = BLACK;
