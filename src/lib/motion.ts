/**
 * SSoT de motion — a forma JS dos tokens que `globals.css` declara em CSS.
 *
 * Regra única: nenhum componente escreve um cubic-bezier ou uma duração na unha.
 * Ou usa um símbolo daqui (framer/`motion`), ou uma utility da Tailwind que já
 * herda `--default-transition-*`. Dois donos para a mesma decisão é como o
 * easing da casa se perde.
 *
 * Valores vindos de Emil Kowalski (animations.dev) / Apple *Designing Fluid
 * Interfaces* — os mesmos usados no visant-board, para que uma peça migre entre
 * repos sem mudar de feel.
 *
 * ⚠️ Mudou aqui, muda no `:root` de `globals.css`. Os dois são espelho.
 */

/** Enter/exit e qualquer coisa que responda a input. O default. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Movimento/morfar de algo que JÁ está na tela (não entrada nem saída). */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
/** Sheets e drawers — a curva iOS. */
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** Escala de duração em SEGUNDOS (framer fala em segundos; o CSS, em ms). */
export const DUR = {
  press: 0.12,
  fast: 0.16,
  base: 0.2,
  slow: 0.3,
} as const;

export const transitions = {
  press: { duration: DUR.press, ease: EASE_OUT },
  fast: { duration: DUR.fast, ease: EASE_OUT },
  base: { duration: DUR.base, ease: EASE_OUT },
  slow: { duration: DUR.slow, ease: EASE_OUT },
  drawer: { duration: DUR.slow, ease: EASE_DRAWER },
  /** Só para momento/gesto (drag, flick). Um menu que some usa duração, não mola. */
  spring: { type: "spring", stiffness: 400, damping: 30 },
  springSoft: { type: "spring", stiffness: 260, damping: 26 },
} as const;

export const fade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: transitions.base },
} as const;

export const fadeInUp = {
  // Nunca `scale(0)` nem y grande: a peça já nasce quase no lugar, só assenta.
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: transitions.base },
} as const;

/**
 * Entrada de item de lista. O stagger é curto e **capado**: numa grade de 60
 * cards, `i * step` sem teto faria o último card entrar 2,4s depois do primeiro
 * — isso não lê como cascata, lê como app travando.
 */
export function itemEnter(i: number, step = 0.03, cap = 0.24) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.base, ease: EASE_OUT, delay: Math.min(i * step, cap) },
  };
}

/**
 * Feedback de pressão para card/tile clicável.
 * `whileTap` precisa da PRÓPRIA transition — sem isso ele herda a de entrada
 * (lenta) e o toque responde depois do dedo já ter saído.
 */
export const pressable = {
  whileTap: { scale: 0.985, transition: transitions.press },
} as const;
