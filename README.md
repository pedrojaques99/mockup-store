# mockup-store

Catálogo e editor de mockups da BOXY/Visant. Duas metades que se encontram no mesmo
grid:

- **PSD** — indexa bibliotecas de PSD no disco, acha as faces editáveis e compõe a arte
  dentro delas (perspectiva, máscara, blend, smart objects vinculados).
- **Foto** — pega uma foto real ou uma cena gerada, detecta a superfície anunciante e
  renderiza a arte por cima, sem Photoshop e sem PSD.

Em cima disso roda um loop headless (`scripts/photo-agent.ts`, `scripts/agent-cli.ts`)
que produz lote de mockups por marca, byte-idêntico ao que a interface mostra.

---

## Como usar em 3 cliques

Com o app aberto (`npm run dev` → http://localhost:3000):

1. **Escolha um mockup.** Clique em qualquer imagem do grid. Abre um painel à direita
   com ele.
2. **Solte sua arte.** Arraste seu PNG na prévia do painel, ou clique nela para
   procurar no computador. O tamanho certo em pixels está escrito no cabeçalho
   "Sua arte" — é o número para desenhar antes de voltar.
3. **Gere e baixe.** Botão **Gerar PNG**, espera o render, **Baixar PNG**.

É isso. Se o mockup tiver mais de uma face (um mural de pôsteres, por exemplo), cada
face vira um slot na lista e você repete o passo 2 em cada uma.

O mesmo tutorial mora dentro do app: abre sozinho na primeira visita e depois fica no
botão **?** do topo.

**Tem uma foto sua em vez de um PSD?** `/photo-mockup` (o *Scene Maker*) detecta a
superfície anunciante na foto e coloca a arte por cima — sem Photoshop e sem PSD.

## Rodando

```bash
npm ci          # o .npmrc já cuida do legacy-peer-deps
npm run setup   # cria .env.local, semeia a cena de demonstração, mede o ambiente
npm run dev     # http://localhost:3000
```

Precisa de **Node >= 22**. Mais nada é obrigatório: o app sobe, o grid lista, o filtro
filtra e a busca acha sem banco, sem chave de API e sem serviço externo nenhum. O
`npm run setup` imprime o que está ligado na sua máquina e o que cada peça ausente
desliga — ele mede, não promete.

Se algo parecer errado, `npm run doctor` audita as cenas e
`npm run smoke -- --url http://localhost:3000` percorre o caminho que o usuário
percorre (home responde? filtro filtra? busca acha?).

## O que cada peça liga

Nada aqui bloqueia o `npm run dev`. Cada linha desliga um pedaço, e só ele.

| Peça | Sem ela |
|---|---|
| `MONGODB_URI` + `MONGODB_DB_NAME` | catálogo lê só o disco; ingest e publicar respondem 500 |
| `PSD_DIRS` | nenhum PSD entra no catálogo; as cenas de foto seguem |
| `OVERLAY_DIRS` | galeria de overlays (Luz/Sombra) fica vazia |
| **render-server** (`npm run render`, porta 4200) | navegar e buscar funciona, renderizar não |
| `VISANT_API_KEY` | lotes por marca (`agent-cli`, brand kit) indisponíveis |
| `REPLICATE_API_TOKEN` | segmentação, profundidade, reluz e upscale desligados |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | as ferramentas assistidas correspondentes |

Todas as variáveis estão comentadas uma a uma no [`.env.example`](.env.example).

## Dois runtimes, de propósito

- **Node (via `tsx`)** para tudo que fala com o Mongo. O `bun` não resolve
  `mongodb+srv` no Windows.
- **`bun`** só para o render-server (`npm run render` e `npm run render:ps`), que usa
  top-level await e é um servidor TCP puro, não HTTP.

Se você não vai renderizar, não precisa instalar o bun.

## Rodando fora do Windows

O app e o pipeline de foto são portáveis. O que é Windows-only está isolado e é
opcional:

- `scripts/ps-render-server.ts` e `scripts/photoshop-render.ps1` — render via COM do
  Photoshop, uma alternativa ao engine próprio.
- `scripts/remove-dupes.ps1`.
- Vários scripts em `scripts/` são bancada de laboratório do autor, com caminhos
  absolutos (`Z:/`, `H:/`) escritos no código. Eles não fazem parte da API do projeto;
  trate como anotação, não como ferramenta. Os que valem para qualquer máquina estão
  documentados no [`AGENTS.md`](AGENTS.md).

## Estrutura

- `src/app` — rotas do Next (App Router). A home é o grid; `/photo-mockup` é o editor
  de cena; `/calibrate` é a prévia que prova o WYSIWYG.
- `src/lib` — o miolo testável: catálogo e busca (`search-index`, `search-engine`),
  render (`photo-render-core`), loop headless (`agent-mockup`).
- `scripts/` — CLIs e bancada.
- `docs/` — planos e auditorias, um por frente de trabalho.
- [`AGENTS.md`](AGENTS.md) — o manual de operação: como disparar lote por marca, como
  gerar cena nova, as regras que vieram de erro real.

## Qualidade

`npm test` (unidade), `npm run lint`, `npx tsc --noEmit`, `npm run ui:audit` (placar da
UI com teto: modal escrito à mão, `<select>` nativo, duração fora do token, botão sem
nome acessível). Tudo isso roda no CI a cada push, mais um job que clona do zero, sobe
o app sem nenhuma variável de ambiente e passa o smoke por cima — é o que mantém este
README honesto.
