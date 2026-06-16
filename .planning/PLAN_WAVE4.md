# Wave 4 — Client-Side Preview Rendering

**Goal:** Preview PSD mockup updates in real-time client-side (CPU/GPU do usuário), sem round-trip TCP.  
Export final (full-res) continua no render-server. Engine = SSOT para browser e server.

**Status:** COMPLETE (2026-06-15)

---

## Arquitetura

```
Preview (crop/zoom) ──► Web Worker ──► OffscreenCanvas (psd-engine) ──► blob URL ──► <img>
Export final         ──► render-server TCP 4200 (node-canvas, full-res)  (sem mudança)
```

psd-engine é o SSOT: mesma lógica de compositing roda no Worker e no servidor.

---

## Wave 4A — psd-engine: suporte async + browser helpers

### Task 4A.1 — `FsCallbacks.read` aceita Promise
**Arquivo:** `Z:\Cursor\visantlabs-os\packages\psd-engine\src\displacement.ts`

Mudar `read` para aceitar retorno síncrono ou assíncrono:
```typescript
read: (path: string) => Uint8Array | ArrayBufferLike | Promise<Uint8Array | ArrayBufferLike>;
```
`preloadDisplacementMaps` passa a `await fs.read(p)`.  
Node.js: `await syncValue === syncValue` — não breaking.

### Task 4A.2 — `createBrowserFsCallbacks()` helper
**Arquivo:** `Z:\Cursor\visantlabs-os\packages\psd-engine\src\displacement.ts`

```typescript
export function createBrowserFsCallbacks(
  fetcher: (path: string) => Promise<ArrayBuffer>
): FsCallbacks {
  return {
    exists: () => true,        // try/catch em read cobre 404
    read: (p) => fetcher(p),   // async fetch via API
    resolve: (base, ...parts) => [base, ...parts].join('/').replace(/\/+/g, '/'),
    dirname: (p) => p.replace(/\/[^/]*$/, '') || '.',
    basename: (p, ext?) => {
      const n = p.replace(/.*\//, '');
      return ext && n.endsWith(ext) ? n.slice(0, -ext.length) : n;
    },
  };
}
```

### Task 4A.3 — Export em `index.ts`
Adicionar: `export { createBrowserFsCallbacks } from './displacement.js';`

### Task 4A.4 — Build psd-engine
`npm run build` — 0 erros TypeScript.

---

## Wave 4B — mockup-store: infraestrutura

### Task 4B.1 — `/api/psd-binary/route.ts`
Serve arquivo PSD como `ArrayBuffer` para o Worker.  
Segurança: valida que o path está dentro dos PSD dirs permitidos.

```typescript
// GET /api/psd-binary?path=<encoded-path>
// Returns: Content-Type: application/octet-stream
```

### Task 4B.2 — `src/workers/render.worker.ts`
Web Worker que faz compositing client-side:
- Recebe: `{ psdArrayBuffer, arts: [{smartObject, artBase64}], psdPath, hideLayers? }`
- `agPsd.initializeCanvas((w,h) => new OffscreenCanvas(w,h))`
- `preloadDisplacementMaps` com `createBrowserFsCallbacks(fetcher)`
- `replaceLinkedSmartObjects` com `createImageBitmap(blob)`
- `composePsd` → `OffscreenCanvas`
- Retorna: `{ blob: Blob }` (JPEG 85%)

### Task 4B.3 — Update `handleRender` em `page.tsx`
Separar em dois caminhos:
```typescript
if (preview) {
  // Client-side: Worker
  await handlePreviewWorker(arts);
} else {
  // Server-side: TCP render-server (sem mudança)
  await handleRenderServer(arts);
}
```

Worker lifecycle:
- `workerRef = useRef<Worker>(null)` — lazy-init no primeiro preview
- Terminates old request via `worker.postMessage({ cancel: true })` antes de novo
- `setRenderResult(URL.createObjectURL(blob))` — blob URL direto na `<img>`
- Cleanup: `URL.revokeObjectURL` quando result muda

---

## Acceptance Criteria

- [x] `FsCallbacks.read` aceita `Promise<>` — Node.js ainda funciona (não breaking)
- [x] `createBrowserFsCallbacks(fetcher)` exportado de `@visant/psd-engine`
- [x] `GET /api/psd-binary?path=` serve PSD com validação de path
- [x] `render.worker.ts` compila — Next.js build `✓` sem erros
- [x] Preview ao mudar crop/zoom dispara Worker (600ms debounce) — sem TCP
- [x] Export final (`preview=false`) ainda usa render-server — sem regressão
- [x] Worker é lazy-init — não afeta performance inicial da página
- [x] Sem código duplicado de compositing (engine = SSOT)
