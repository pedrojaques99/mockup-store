# PLAN — cor sólida editável no mockup

> Status: **feito de ponta a ponta e com portão** (`npm run check:colors`).
> Engine 0.2.4 (`src/colors.ts`) · API · UI · prévia. Falta só publicar a 0.2.4
> no npm — até lá o `node_modules` daqui está na 0.2.3 e a cor não funciona
> num clone limpo.

## O que o arquivo já oferece

O template BOXY separa a cor do produto numa camada própria e nomeia em português
claro. Medido nos PSDs da amostra:

| PSD | camadas de cor | hex declarado |
|---|---|---|
| Coffee Paper Cups | `Left/Middle/Right Cup Color` | `#0e0e0e` · `#8a7351` · `#e2e0a4` |
| boxes_scene_3_bg | `Cor do Fundo`, `Cor da Caixa` | `#ecf9db` · `#131313` |
| Double Cards Stack | `Cor do Fundo` | `#7eb636` |

São **Solid Color fill layers**, e o `ag-psd` as entrega de duas formas ao mesmo
tempo: `vectorFill.color` (a cor declarada) e `canvas` (a mesma cor já
rasterizada e recortada pela máscara). Todas com blend `multiply` e opacidade
0,8 — ou seja, a cor entra POR BAIXO do sombreado, e trocar não achata o
produto. É o que a prova mostrou: três copos recoloridos com o relevo intacto.

## Engine — feito

`packages/psd-engine/src/colors.ts`, exportado na raiz:

```ts
computeColorSlots(allLayers): ColorSlot[]   // { path, name, hex, blendMode, opacity, hidden }
applyColorOverrides(allLayers, { [path|name]: hex }, cc): string[]  // paths aplicados
rgbParaHex / hexParaRgb
```

Duas decisões que valem registro:

- ⚠️ **Repinta preservando o ALPHA do canvas**, em vez de redesenhar pela
  máscara. A forma e o antisserrilhado da borda moram no alpha; refazer pela
  máscara devolveria borda dura que o PSD não tem.
- ⚠️ **Escreve no `__original`** — o objeto real da árvore que o `composePsd` lê.
  `flattenLayers` devolve cópias rasas; mexer nelas não muda o render, e o
  sintoma seria a cor "não pegar", sem erro nenhum.
- Camada **oculta entra na lista** de propósito (`hidden: true`): o template traz
  variantes desligadas, e escondê-las da UI esconderia metade das opções que o
  arquivo oferece. Quem exibe decide.
- Pedir uma camada que não existe **não** falha calado: a função devolve o que
  aplicou, e o chamador compara com o que pediu.

## API — feito

- `GET /api/psd-info` devolve `colorSlots` ao lado de `faces`. Registro indexado
  antes do campo existir lê do disco **uma vez por processo** (cache por
  `filePath`): reindexar 3.520 PSDs para ganhar um campo é abrir cada arquivo de
  novo, que é justamente o trabalho que o seed existe para evitar. `scanPsd`
  passou a gravar o campo, então isso se resolve sozinho com o tempo.
- `POST /api/render` aceita `colors: { [path]: "#rrggbb" }`. **Só hex de 6
  dígitos passa** — o valor vai para o `fillStyle` do canvas no render-server, e
  string arbitrária ali é começo de superfície de injeção.
- O render-server aplica antes de compor e **avisa** quando a camada pedida não
  existe no arquivo. Renderizar com a cor velha calado é o caminho mais rápido
  para o usuário achar que a UI não funciona.
- A **prévia do worker** aplica também. Escolher a cor num lugar e descobrir no
  outro é o mesmo defeito de WYSIWYG que o render-core já resolveu uma vez.

## UI — feita

`src/components/ui/ColorPicker.tsx` (novo primitivo, autorizado): swatches +
`<input type="color">` nativo atrás da bolinha com `conic-gradient`. Colhido do
`ArtFramePanel`, que passou a usá-lo — some a duplicata.

O nativo é escolha, não preguiça: ele traz o seletor do sistema (conta-gotas de
tela, paleta recente, acessibilidade) de graça, e nenhuma roda de matiz escrita à
mão empata com isso.

No `SmartObjectList`, as cores entram como bloco **fora da caixa de rolagem** dos
smart objects. ⚠️ Na primeira versão elas ficaram dentro: num PSD com 7 SOs, o
seletor nascia abaixo da dobra de um scroll de 288px — existia no DOM e não
existia para o usuário. Só a captura mostrou; a verificação por DOM dizia
"3 pickers, ok".

Voltar para a cor do arquivo **remove a chave** em vez de gravar o mesmo valor,
para o render não receber uma troca que não é troca. Trocar de PSD limpa tudo:
as camadas do próximo têm outros paths.

## Portão — `npm run check:colors`

```
npm run check:colors -- --url http://localhost:4100
```

Teste **diferencial**: dois renders da mesma cena, só o campo `colors` muda, e
conta-se quanto do quadro mudou. Medir "a cor apareceu" procurando pixel rosa não
serve — é o mesmo erro que o `pack:publish` já pagou com a arte, porque cenário
colorido é indistinguível de cor aplicada. Provado nos dois sentidos: com a cor
passando, 10,57% dos pixels e `exit 0`; cortando a passagem no route, **0,00%** e
`exit 1`.

Ele também confere que camada inexistente é ignorada sem quebrar o render.

⚠️ **Na primeira execução ele deu 0,00% com o código certo.** Era um
render-server ZUMBI de outra sessão segurando a 4200 com o código antigo — a
mesma armadilha que o `check:offline` documenta: no Windows `kill` não mata,
é `taskkill /T`. Sintoma: o `npm run render` loga "Failed to listen" e o portão
mede o servidor errado.

## Falta — cor pela CENA

No Scene Package as camadas de cor são achatadas dentro do `base`. Para
recolorir pela cena seria preciso emiti-las como camada própria com um
`colorSlot` ref. Não é bloqueante: o render de produção usa o caminho do PSD.
