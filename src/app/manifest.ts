import type { MetadataRoute } from "next";

/**
 * Manifest PWA. O ponto-chave aqui é `file_handlers`: depois que o app é instalado
 * (Chromium desktop → "Instalar app"), o OS registra a extensão `.vsn` e um
 * double-click no arquivo abre direto em `/photo-mockup` — a página consome o
 * arquivo via `launchQueue` (File Handling API). Sem app instalado, os caminhos
 * "Abrir" / arrastar-e-soltar continuam valendo.
 *
 * `file_handlers` e `launch_handler` ainda não estão no tipo do Next → cast.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BOXY® Mockup Store",
    short_name: "BOXY®",
    description: "Editor de mockups foto → arte (photo-mockup).",
    start_url: "/photo-mockup",
    display: "standalone",
    /* Ink Black e o verde da marca, não o `#0a0a0a` genérico. O ícone era o
     * `/globe.svg` do scaffolding do Next: o app instalado no OS aparecia com o
     * globinho do framework. Agora é o arquivo oficial `logo-boxy-icon.png`,
     * copiado sem edição (também em `app/icon.png`, para o favicon). */
    background_color: "#161616",
    theme_color: "#BFFF38",
    icons: [
      { src: "/brand/boxy-symbol.png", sizes: "574x481", type: "image/png", purpose: "any" },
    ],
    file_handlers: [
      { action: "/photo-mockup", accept: { "application/octet-stream": [".vsn"] } },
    ],
    launch_handler: { client_mode: "focus-existing" },
  } as MetadataRoute.Manifest;
}
