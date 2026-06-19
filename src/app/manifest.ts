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
    name: "BOXY Mockup Store",
    short_name: "BOXY",
    description: "Editor de mockups foto → arte (photo-mockup).",
    start_url: "/photo-mockup",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/globe.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    file_handlers: [
      { action: "/photo-mockup", accept: { "application/octet-stream": [".vsn"] } },
    ],
    launch_handler: { client_mode: "focus-existing" },
  } as MetadataRoute.Manifest;
}
