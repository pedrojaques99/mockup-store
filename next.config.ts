import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Permite medir a build de produção sem brigar pelo `.next` com um dev server aberto:
  // `NEXT_DIST_DIR=.next-prod next build`. Sem a variável, nada muda.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: {
    // Next 16 exige declarar as rotas locais que servem imagem com query string —
    // sem isto, todo card do grid (`/api/local-image?path=…`) vira warn no console.
    localPatterns: [
      { pathname: "/api/**" }, // rotas próprias: query livre (o path do arquivo vai nela)
      { pathname: "/**", search: "" }, // estáticos (public/): sem query
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-0acbd500af3b4beaa8b93b07f6490d58.r2.dev",
      },
    ],
    // O TTL efetivo do otimizador é `max(minimumCacheTTL, max-age da fonte)` —
    // com o default de 4h, a variante já otimizada era descartada e o Next voltava
    // a BUSCAR a fonte de 13 MB no Google Drive para regerar exatamente o mesmo
    // WebP. O arquivo-fonte não muda (e quando muda, muda de mtime e a chave do
    // cache da rota muda junto), então revalidar de 4 em 4 horas é trabalho puro.
    minimumCacheTTL: 2_678_400, // 31 dias
  },
  // Thumbnail do grid é imutável por id (o id É o hash da cena) — sem isto o browser
  // revalidava os 60 cards da primeira página a cada visita. `must-revalidate` de fora
  // porque o arquivo pode ser regravado por um republish da mesma cena.
  async headers() {
    return [
      {
        source: "/photo-previews/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
  serverExternalPackages: [
    "ag-psd", "sharp", "mongodb", "@printmadehq/mockup-generator",
    "puppeteer", "canvas", "@visant/psd-engine",
  ],
  experimental: {
    /**
     * TETO DO CORPO DA REQUISIÇÃO — o `SyntaxError: Unexpected end of JSON input`.
     *
     * Existe `src/middleware.ts` (injeta `x-tenant`), e todo request que casa o
     * matcher tem o corpo CLONADO pelo Next antes de chegar na rota. O clone tem
     * teto (`DEFAULT_BODY_CLONE_SIZE_LIMIT`, 10 MB) e, estourado o teto, o corpo é
     * **truncado em silêncio**: o middleware nem lê corpo nenhum, mas a rota recebe
     * um JSON cortado no meio.
     *
     * O estrago era mudo em três camadas. `req.json()` da rota estourava, o handler
     * morria antes de qualquer `NextResponse.json`, o Next devolvia **500 com corpo
     * vazio**, e o `res.json()` do cliente estourava de novo — o usuário via
     * "SyntaxError: Unexpected end of JSON input" no lugar de "sua arte é grande
     * demais". Medido: 9 MB passa, 10 MB quebra.
     *
     * Quem estoura isso é o caminho normal do produto, não um caso exótico: `arts[]`
     * leva PNG full-res em base64 (+33%), e mockup multi-face manda uma arte POR
     * FACE — dois smart objects de 2000×2832 já passam de 10 MB. `/api/search-by-image`
     * e `/api/calibrate/render` mandam imagem inteira pelo mesmo cano.
     */
    middlewareClientMaxBodySize: "64mb",
    /**
     * O dev server pré-carregava TODAS as rotas na memória ao subir: 566 MB de RSS
     * antes de servir o primeiro request (medido). Com isto, cada rota entra quando
     * é pedida — o custo continua existindo, mas só para as rotas que você abre, e
     * não para as ~40 rotas de API que este app tem.
     */
    preloadEntriesOnStart: false,
    /**
     * Troca memória por um pouco de tempo de compilação no webpack. É o knob que a
     * própria doc do Next indica para "Building large applications".
     */
    webpackMemoryOptimizations: true,
  },
  /**
   * TURBOPACK: NÃO dá para usar neste repo hoje.
   *
   * Medido: `next dev --turbopack` morre em toda rota que toca o engine, com
   * "Can't resolve '@visant/psd-engine'". O pacote é um symlink para fora da
   * árvore (`Z:\Cursor\visantlabs-os\packages\psd-engine`) e o Turbopack, depois
   * de seguir o symlink, recusa o caminho real por estar fora da raiz do projeto
   * — inclusive quando apontado por `resolveAlias` absoluto. As saídas seriam
   * alargar a raiz para `Z:\` (o watcher passaria a vigiar o disco inteiro, com
   * milhares de PSDs) ou reescrever os 5 pontos de import do engine para fugir do
   * bundler. Nenhuma das duas paga o preço. O alias abaixo fica pronto para o dia
   * em que o engine virar dependência publicada — aí `--turbopack` deve valer os
   * ~900 MB de diferença.
   */
  turbopack: {
    resolveAlias: {
      // SAM2 no browser: bundle pré-compilado WebGPU+WASM.
      "onnxruntime-web/all": "./node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs",
    },
  },
  webpack(config, { isServer, dev }) {
    /**
     * Source map do dev é caro em memória: o webpack guarda o mapa de CADA módulo
     * do grafo, e este app compila a home inteira num arquivo só. Ligar
     * `DEV_NO_SOURCEMAPS=1` desliga (útil quando a máquina está apertada ou num
     * lote longo de render); o padrão continua sendo o do Next, com stack trace
     * apontando para o `.tsx` de verdade. Opt-in de propósito: debugar às cegas
     * custa mais caro que RAM.
     */
    if (dev && process.env.DEV_NO_SOURCEMAPS === "1") config.devtool = false;

    // onnxruntime-web/all → prebuilt WebGPU+WASM bundle (SAM2 client-side segmentation)
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-web/all": path.join(process.cwd(), "node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs"),
    };

    // canvas is a native Node module. When psd-engine is resolved via a monorepo
    // junction, serverExternalPackages won't intercept it (path resolves to the
    // real disk location, not the package name). Use an externals function instead.
    const canvasExternal = (
      { request }: { request?: string },
      callback: (err?: Error | null, result?: string) => void,
    ) => {
      if (request === 'canvas' || request?.includes('canvas/index') || request?.includes('canvas/lib')) {
        // Server: load at runtime via require(); client/worker: stub as empty object.
        return callback(null, isServer ? 'commonjs canvas' : 'var {}');
      }
      callback();
    };

    const prev = config.externals;
    config.externals = Array.isArray(prev)
      ? [...prev, canvasExternal]
      : prev
        ? [prev, canvasExternal]
        : [canvasExternal];

    return config;
  },
};

export default nextConfig;
