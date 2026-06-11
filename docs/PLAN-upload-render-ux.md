# Plano — UX completa: upload da arte + configuração do render PSD

## Objetivo
Dar controle total ao usuário entre "subir a imagem" e "sair o render perfeito",
sem reescrever o pipeline de render (ag-psd via render-server), que já funciona.

## O que já existe e será aproveitado
| Capacidade | Onde | Status atual |
|---|---|---|
| Render rápido em JPEG (`preview`, ~800px) | `scripts/render-server.ts` | suportado, **não exposto** na rota/UI |
| Esconder layers (`hideLayers`) | render-server + `/api/render` | suportado, **sem UI** |
| Dimensões internas do Smart Object | `/api/psd-info` (`innerWidth/innerHeight`) | exibido, não usado p/ enquadrar |
| Progresso por etapa via SSE | stream do `/api/render` | só erros são mostrados |
| Cover crop central da arte | render-server (canvas) | fixo, sem controle do usuário |

## Decisão chave (não reinventar a roda)
- **Enquadramento client-side** com [`react-easy-crop`](https://www.npmjs.com/package/react-easy-crop)
  (lib validada, pan/zoom/crop com aspect travado).
- A arte é exportada **já enquadrada** no aspect do Smart Object via canvas no browser.
  O cover crop do servidor vira identidade → **zero mudança na lógica de render**.

## Entregas

### 1. Upload melhor
- Drop zone existente + **colar com Ctrl+V** + validação de tipo.
- Mostrar dimensões da arte e **aviso de baixa resolução** quando a região usada
  for menor que as dimensões internas do Smart Object (upscale > 1.5x).

### 2. Editor de enquadramento (novo, painel direito)
- Aspect travado no `innerWidth/innerHeight` do SO selecionado.
- Modos: **Preencher** (cover + pan/zoom com react-easy-crop), **Caber**
  (contain + cor de fundo: transparente/branca/preta/custom), **Esticar**.
- Export client-side: canvas no tamanho interno do SO (cap 4096px).

### 3. Preview rápido vs Render final
- Botão "Preview rápido" → `preview: true` (JPEG ~800px, segundos).
- Botão "Render final" → PNG full-res (fluxo atual).
- Rota `/api/render` passa `preview` adiante; GET detecta JPEG/PNG por magic bytes.

### 4. Controle de layers
- Checkboxes nos ajustes/layers editáveis do PSD → alimentam `hideLayers`.

### 5. Feedback de progresso real
- Mostrar a etapa atual do stream SSE (lendo PSD, substituindo SO, compondo…)
  em vez de só o cronômetro.

## Arquivos
| Arquivo | Ação |
|---|---|
| `src/lib/art-frame.ts` | novo — matemática pura (coverCrop, containRect, exportSize, isLowRes) + export canvas |
| `src/lib/__tests__/art-frame.test.ts` | novo — testes vitest da matemática |
| `src/app/art-framer.tsx` | novo — componente do editor (react-easy-crop), mesmo design system da página |
| `src/app/page.tsx` | editar — integra framer, paste, preview/final, layers, progresso |
| `src/app/api/render/route.ts` | editar — repassa `preview`, content-type por magic bytes |
| `package.json` | + `react-easy-crop` |

## Fora de escopo (v2)
- Arte diferente por Smart Object no mesmo PSD.
- Rotação da arte / ajustes de cor.
- Comparador antes/depois.
