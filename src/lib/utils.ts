import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution (shadcn-style). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Decimal na vírgula, que é como número se escreve em português.
 *
 * `toFixed` devolve ponto, e o app inteiro estava mandando `4.6×`, `12.3 MB`,
 * `1.9s` para uma tela em pt-BR. Só apareceu quando alguém ABRIU a captura: nada
 * disso quebra, compila ou falha em teste, e ainda assim é o app falando com
 * sotaque. `Intl` resolveria, mas custa um formatador por chamada num número que
 * atualiza a cada segundo.
 */
export function dec(n: number, casas = 1): string {
  return n.toFixed(casas).replace(".", ",");
}
