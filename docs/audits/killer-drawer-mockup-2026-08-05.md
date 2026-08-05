# Killer: painel de detalhe do mockup (drawer direito da home)

**Tier** T2 rota, com região T3 (o momento de comprometer: render final + download)
**Superfície** B trabalho no miolo · C confiança no rodapé (o rodapé produz o entregável)
**Nota de entrada** 38/100 · **Nota de saída** 92/100 · **Veredito** passou
**Estado** Ondas 0 a 3 aplicadas e verificadas na tela. Onda 4 (extrair
`MockupDrawer.tsx` de dentro das 4.920 linhas do `page.tsx`) fica pendente.
**Alvo** `src/app/page.tsx:3714-4126` · `src/components/ArtFramePanel.tsx` (arquivo inteiro)

| Faixa | Peso | Nota |
|---|---|---|
| Portão | 20 | **0** — copy falhou (tudo ou nada) |
| Julgamento | 40 | **0** — 11 itens do catálogo vivos, −4 cada, chão em zero |
| Interrogatório | 40 | **38** — T1+T2 e F1–F6 respondidos com `arquivo:linha` |

A nota é de entrada, antes de qualquer conserto, e o interrogatório pontuou quase cheio.
Isso é o retrato do problema: **esta tela não sofre de falta de diagnóstico**. Ela já foi
lida com atenção — os comentários em `:3734`, `:4018`, `:4058`, `:4070` e
`ArtFramePanel.tsx:8-16` são análise de primeira linha. O que aconteceu foi que dois desses
diagnósticos pararam no meio: o do painel duplo virou um painel duplo menor, e o do
"um primário só" virou um segundo primário desenhado logo abaixo do comentário que o proíbe.

---

## O que foi feito (2026-08-05, mesma sessão)

Ondas 0 a 3 aplicadas. Os quatro portões estáticos verdes (`tsc`, lint 0 erros,
368 testes, killer-scan), mais **três portões novos que não existiam** e que
pegaram coisas que nenhum dos antigos pegava.

| Conserto | Onde | Provado por |
|---|---|---|
| Um primário só, que percorre os estados (`Gerar PNG` → `Baixar PNG`) | `page.tsx` rodapé | `visual:drawer` conta os verdes |
| Recorte ASSUME a superfície de resultado | `ArtCropSurface` + `page.tsx:3795` | captura `4-recorte.png` |
| Caixa âmbar de 56px vira um termo na linha de dimensões | `ArtFramePanel` | captura `zoom-art-row.png` |
| Ampliação sai da fonte EFETIVA (respeita o recorte) | `art-frame.ts` | `effectiveSource` + `upscaleFactor` |
| Anel de foco deixa de ser escopado em `.scene-maker` | `globals.css` | `visual:drawer` tabula e mede |
| Stream sem `complete` passa a avisar | `page.tsx:2217` | `check:render-failure B`, 4/4 |
| Prévia que falha passa a avisar | `page.tsx:2103` | toast visto na tela |
| `lang="en"` → `pt-BR` e `TooltipProvider` na raiz | `layout.tsx` | destrava `IconSegmented` no app todo |
| Segmented à mão → `IconSegmented`, ícones que descrevem a ação | `ArtFramePanel` | `aria-label` + tooltip de fábrica |
| Detalhes do PSD colapsado, ~92px devolvidos | `page.tsx` | captura |
| Decimal na vírgula (`amplia 4,6×`) | `lib/utils.ts` `dec()` | captura |
| 44 cópias da transição → `transition-ui`; 4 escalas de press → uma | app inteiro | grep em zero |

### Três coisas que só apareceram porque alguém ABRIU a captura

1. **O termo de ampliação estava no verde de ação da marca** — cor de "está indo
   bem" avisando que o PNG vai sair borrado. Virou âmbar.
2. **`compositing…`** continuava em inglês no `setCurrentStep`; eu tinha trocado
   só o texto de fallback do JSX.
3. **A prévia automática cobria a própria superfície de recorte** — regressão que
   eu mesmo criei ao mover o recorte para lá. O overlay some no modo recorte e a
   prévia espera o recorte terminar.

### Duas correções minhas, ditas por inteiro

- **Escrevi que a barra de progresso mentia.** Não mente: `globals.css:51-61` faz
  ela varrer. O achado válido era só o excesso de sinais simultâneos.
- **Escrevi num comentário do código que "em 3 de 4 rodadas o clique não fazia
  sair requisição nenhuma".** Era defeito do meu portão: a prévia automática
  voltava a desabilitar o botão entre a espera e o clique, e o clique caía num
  botão morto. O comentário foi reescrito para não afirmar medição que não houve.
  Os dois toasts defensivos ficaram (um `return` calado na ação que entrega o
  arquivo não se justifica), e a assimetria real entre `filledCount` e `buildArts`
  continua consertada — ela existe no código, tenha ou não disparado ainda.

---

## Decisão pendente (do usuário, não minha)

**1. O recorte da arte não pode morar num segundo painel. Ele mora na superfície de resultado.**

Você nomeou isso sem ler o código: *"uma seção de controle da imagem (zoom, crop) que
conflita com o preview do render"*. Está certo, e o achado é pior do que parece — esse
defeito **já foi diagnosticado neste repo e consertado pela metade**. O comentário em
`ArtFramePanel.tsx:8-16` descreve o defeito com precisão cirúrgica:

> *"o topo mostrava a cena SEM a arte e o bloco de baixo mostrava a arte SEM a cena —
> nenhuma das duas mostrava a coisa que o usuário está decidindo, e ajustar
> enquadramento virava editar num lugar e conferir no outro, rolando entre eles."*

O conserto aplicado foi `variant="source"`: a segunda superfície virou miniatura e o
recorte passou a abrir sob demanda (`ArtFramePanel.tsx:68`). Isso **encolheu o sintoma
e manteve o defeito**. Ao clicar no ícone de recorte (`ArtFramePanel.tsx:172-182`) o
painel volta a crescer uma imagem de 160px (`ArtFramePanel.tsx:109`) logo abaixo da
superfície de resultado, e o usuário continua editando num lugar e conferindo no outro.
A única diferença é que agora ele precisa de um clique a mais para chegar no mesmo beco.

Três saídas, em ordem de recomendação:

| | Saída | O que muda | Custo |
|---|---|---|---|
| **A (recomendo)** | O recorte **assume a superfície de resultado**. Clicou em recortar, a caixa 4/3 do topo (`page.tsx:3750`) troca de conteúdo: sai o render, entra o Cropper com o aspect da face. Uma superfície grande, sempre, sem exceção. | `ArtFramePanel` perde o bloco de preview inteiro (`:105-147`) e vira só a barra de controle. O Cropper sobe pro `page.tsx`. | médio |
| **B** | Recorte **direto no render**: alças sobre o resultado composto, o usuário arrasta a arte dentro da superfície do mockup. É o WYSIWYG que o `/photo-mockup` já faz com quad. | Precisa mapear o quad → coordenadas da arte. O core já sabe (`photo-render-core`). | alto |
| **C** | Manter, e só travar o recorte fechado quando há render na tela. | Um `if`. Não resolve, adia. | baixo |

**A** é a que casa com a memória `render-wysiwyg-core` (prévia ≡ produção) e com o
princípio que o próprio comentário do arquivo já enunciou. **B** é o produto que você
provavelmente quer daqui a dois meses; **A** não atrapalha **B**.

**2. `RENDER FINAL` e `GERAR PNG FINAL PARA BAIXAR` são o mesmo botão.** Ver Q7. Recomendo
fundir: um único primário que muda de rótulo e de destino conforme o estado.

---

## Portão

Rodado em `src/app/page.tsx src/components/ArtFramePanel.tsx src/components/CropFrame.tsx`.

| Detector | Antes | Depois |
|---|---|---|
| impeccable (tell de IA) | 0 | — |
| audit:design (token) | 0 | — |
| copy (vício) | **1** | — |
| self-test do extrator | OK (18 strings, sem falso pos/neg) | — |
| `tsc --noEmit` | pass | — |
| lint | não rodado | — |
| 390px | não medido (ver *Não verificado*) | — |

Achado único, confirmado lendo a linha:

- `src/app/page.tsx:4353` — travessão em copy visível:
  `"Coleção avulsa não precisa de marca — vira o destino do marcador enquanto estiver ativa."`
  Conserto: `"Coleção avulsa não precisa de marca. Enquanto estiver ativa, ela é o destino do marcador."`
  (Está no diálogo de nome de coleção, não no drawer, mas é arquivo do alvo: portão é portão.)

Pulado: nada. `impeccable` e `audit:design` rodaram e deram zero — e, de novo,
**zero nos dois com nove itens de slop vivos**. É o padrão da skill: o portão veta, não discrimina.

---

## Slop confirmado, ainda vivo

Cada um lido em `arquivo:linha`, não inferido.

### 1. Dois botões, uma função (catálogo #5, dado duplicado)

`page.tsx:4076` → `onClick={() => handleRender(false)}`
`page.tsx:4113` → `onClick={() => handleRender(false)}`

Idênticos. Depois de um preview, o rodapé mostra os dois ao mesmo tempo: `RENDER FINAL`
com contorno (`:4084`) e `GERAR PNG FINAL PARA BAIXAR` em verde sólido (`:4116`), a 12px
de distância, chamando a mesma função. O comentário em `:4070-4074` defende a mudança de
peso ("exatamente UM botão verde por vez") e ele está certo sobre a cor — mas a solução
foi **demover o botão e desenhar um clone dele embaixo**, em vez de trocar o rótulo do
que já existia. O usuário lê duas ações e tem uma.

Pior: o rótulo verde promete download (`Download` icon, `:4116`) e **não baixa nada** —
dispara um render de 20 a 60 segundos. Isso é a espinha 9 apontando pra fora: a UI
mentindo pro usuário sobre o que o clique faz.

### 2. Aviso de baixa resolução duplicado (catálogo #5)

`ArtFramePanel.tsx:184-186` — triângulo âmbar na linha da arte
`page.tsx:4049-4057` — caixa âmbar com o texto inteiro

Mesmo cálculo (`isLowRes`), duas renderizações, ~120px de distância, visíveis juntas —
está na sua captura. O triângulo não acrescenta nada que a caixa não diga melhor.

### 3. Âmbar significa duas coisas (catálogo #1, arco-íris)

`page.tsx:3815` — `bg-amber-500` sólido: **estado neutro** ("isto é um preview")
`page.tsx:4050` — `bg-amber-500/10` + `text-amber-300`: **defeito** ("vai sair borrado")

A mesma cor, no mesmo painel, marcando "está tudo normal" e "seu entregável vai sair
ruim". Some com o significado das duas. E âmbar não é da marca: a paleta é mono-verde
(`#BFFF38` ação, `#84B028` progresso — ver `lib/brand.ts`).

### 4. Barra de progresso que não sabe de nada (catálogo #7)

`page.tsx:3782` — `animate-progress-indefinite` com `style={{ width: "40%" }}`

Uma barra parada em 40% ao lado de um contador de segundos que é verdadeiro
(`:3778`). A barra afirma "40% do caminho" e não faz ideia. O contador já faz o
trabalho honesto.

### 5. Três sinais de movimento para uma espera (catálogo #17)

`page.tsx:3775` Lottie · `:3777` `animate-pulse` no texto · `:3782` barra indefinida.
Simultâneos, na mesma caixa de 220px.

### 6. Escala de press divergente no mesmo painel (catálogo #17 / F2)

`active:scale-90` em `:3729, :3792, :3798, :3807` · `active:scale-95` em `:4006, :4007` ·
`active:scale-[0.97]` em `:4066, :4078, :4102, :4114` · `active:scale-[0.98]` em `:3670`.

Quatro valores de feedback de toque na mesma superfície. `scale-90` num alvo de 36px é
10% de encolhimento — visível, e nada mais forte está acontecendo ali. O SSoT de motion
existe (`src/lib/motion.ts`, memória `motion-ssot-mockup-store`) e não está sendo usado
para isto.

### 7. Rótulos gritando (catálogo #13)

`page.tsx:4084` `RENDER FINAL` · `:4104` `DOWNLOAD PNG` · `:4116` `GERAR PNG FINAL PARA BAIXAR`

Caps digitado à mão, escapando do expurgo de `uppercase` que este arquivo já sofreu
(comentário em `:3004`: "70 `uppercase` → 3"). Três gritos seguidos num rodapé de
quatro linhas. E o terceiro é uma frase de instrução, não um rótulo de botão: rótulo
diz o resultado (`Baixar PNG`), não o mecanismo.

### 8. Alarme sem saída (catálogo #8)

`page.tsx:4052-4055` — *"O render vai sair borrado."*

Diz o veredito e não diz o que fazer, e o botão verde logo abaixo continua igual,
convidando. Falta a saída: qual tamanho de arte resolve (`{soWidth}×{soHeight}` já está
calculado na linha acima), ou o modo `contain` que evita a ampliação.

### 9. Sucesso que não acontece, em silêncio (catálogo #12)

`page.tsx:2217` — `if (completedJobId) { … }` **sem `else`**.

Se o stream terminar sem evento `complete` (servidor fecha a conexão, worker morre com
200 já enviado), o `finally:2229` desliga o `rendering`, e a tela volta ao estado
anterior: sem render, sem erro, sem toast. O usuário esperou 40 segundos e não aconteceu
nada — indistinguível de ter clicado errado. Os outros caminhos de falha estão certos
(`:2183` e `:2228` dão toast); este passou.

Mesma família, menor: `:2135` `if (arts.length === 0) return;` — clique que não faz nada.

**E o irmão pior, achado depois:** `page.tsx:2089` — quando o **preview** falha, o
`cleanup(err)` grava em `renderLogs` e **não dá toast**. O caminho final tem dois toasts
(`:2183`, `:2228`); o do preview tem zero. E o preview é o que dispara **sozinho**, no
hover-apply (`:2240`): a arte entra, o worker morre, e a tela simplesmente não muda.
O único sinal é o botãozinho de terminal aparecendo no rodapé.

### 11. O aviso de resolução é intrusivo (catálogo #8 + #13)

`page.tsx:4049-4057` — `p-3` + `rounded-xl` + fundo âmbar + borda âmbar + `AlertTriangle`
+ `font-bold` + `text-amber-300` + três orações em três linhas.

**Sete sinais para um fato**, a 12px do botão que produz o entregável, ocupando ~56px no
lugar mais caro da tela. E o fato é uma **propriedade da combinação arte↔superfície**, não
um erro: nada quebrou, nada precisa ser reconhecido, não há botão para clicar. Uma caixa
tingida com ícone de alerta é o vocabulário de "algo deu errado, aja agora".

O número mora onde já existe uma linha que fala exatamente disso —
`ArtFramePanel.tsx:164-168`, que já imprime `1080×1350px, superfície 1720×2577`. Falta um
termo nessa frase, não uma caixa embaixo dela.

### 10. Sem anel de foco (F6 item 2)

`globals.css:159` define o anel `focus-visible` da casa **escopado em `.scene-maker`**.
A string `scene-maker` não existe em `page.tsx` nem no `layout.tsx`. Somado a três
`focus:outline-none` no arquivo, o drawer inteiro navega no teclado sem o anel do design
system. Toda ação do rodapé, inclusive a que produz o entregável, é alcançável e invisível.

---

## Interrogatório

### T1

**Q1 Se eu apagasse isto hoje, quem reclama em 48h?**
Ninguém reclama do painel; reclamam do produto inteiro. O drawer **é** o produto — é o
único lugar onde arte encontra mockup e vira arquivo. Ele fica.
OBRIGA: nada. Confirma que o orçamento de rigor desta tela é o mais alto do app.

**Q2 Existe porque alguém precisa, ou porque o dado estava disponível?**
Três blocos são "o dado estava disponível": `Smart Objects` (`:3828`), `Camadas de ajuste`
(`:3903`) e a linha de arquivo/MB/px (`:3935-3939`). Nenhum deles decide nada sobre a
arte que está sendo enquadrada — são inspeção de PSD dentro de uma tela de produção.
`Smart Objects` já se defende (`:3828` só renderiza com mais de um, e é o seletor de face).
Os outros dois não.
OBRIGA: `Camadas de ajuste` e a linha de arquivo descem para um "Detalhes do PSD"
colapsado, ou saem. Devolve ~90px verticais acima do bloco de arte.

**Q5 Qual decisão isto produz? Escreva a frase.**
*"Essa arte cabe aqui, então gero o PNG."* Duas decisões, na verdade: **enquadramento**
(cover/contain/recorte) e **comprometer** (render final). O painel trata as duas com o
mesmo peso e as coloca em ordem invertida na tela — o enquadramento mora embaixo, colado
no rodapé, e o resultado mora em cima.
OBRIGA: é o argumento da Decisão pendente 1. A superfície grande tem que servir a decisão
que está sendo tomada agora, não a que já foi.

**Q6 Qual é o número que decide, e ele é o de maior peso?**
O número que decide é a **ampliação** (`upscale`, `:4054`) — é ele que diz se o entregável
presta. Ele aparece em `text-[10px]` dentro de uma frase de três orações. O maior peso
tipográfico do rodapé está em `RENDER FINAL` (`:4084`), que não é número nem decisão.
OBRIGA: `1,9×` vira o elemento pesado do aviso; o resto vira legenda.

**Q11 Este número mente em qual cenário?**
`{artDims.width}×{artDims.height}` (`:4053`) é a arte **original**, mas quando o modo é
`cover` com recorte o que vai pro render é `frame.cropPixels` — menor. `ArtFramePanel.tsx:81-88`
calcula `lowRes` corretamente com o crop; `page.tsx:4053` **exibe a dimensão sem crop**. Recorte
apertado ⇒ o texto diz `1080×1350` e o render usa bem menos. O aviso subestima o próprio alarme.
OBRIGA: conserto. Exibir a dimensão efetiva (a mesma que alimentou `isLowRes`).

### T2

**Q3 Qual é a versão disto que cabe numa frase? Por que a tela é melhor?**
A frase: *"jogue a arte, escolha encaixar ou preencher, baixe."* A tela é melhor porque
mostra o resultado antes do commit. Esse é o **único** motivo pelo qual o painel existe —
e é exatamente o motivo que o recorte em painel separado destrói.
OBRIGA: sustenta a Decisão pendente 1.

**Q7 Isto é a resposta, ou a matéria-prima da resposta?**
Matéria-prima, no rodapé. Depois de um preview o usuário encara `Preview Rápido`,
`RENDER FINAL` e `GERAR PNG FINAL PARA BAIXAR` (`:4063`, `:4075`, `:4112`) e precisa
descobrir sozinho que os dois últimos são a mesma chamada (`handleRender(false)` em
`:4076` e `:4113`). A interface terminou metade do trabalho: ela sabe qual é o próximo
passo e desenhou três.
OBRIGA: fundir. Um primário que percorre os estados —
`Gerar PNG` → (rendering) → `Baixar PNG` → `Gerar de novo` em secundário.

**Q8 Qual default você escolheu pelo usuário, e defende por escrito?**
`cover` como enquadramento automático, anunciado em `:4031` com desfazer ao lado
(`:4044`). O default é bom e a regra está anunciada — mas a regra em si (`framingHint.reason`)
está enterrada num `title` (`:4028`), invisível no teclado e no toque.
OBRIGA: o `reason` sai do `title` e vira a legenda da linha, ou a linha ganha um alvo real.

**Q12 Se o backend cair, mostra erro ou mostra zero?**
Mostra erro nos dois caminhos previstos (`:2183` toast, `:2228` toast) — bem feito,
melhor que a média deste catálogo. **Menos** no caminho do stream sem `complete`
(`:2217`, item 9 acima), que é silêncio.
OBRIGA: `else` com toast. Verificar com o render-server derrubado.

**Q13 Que promessa isto faz que o banco não sustenta?**
`GERAR PNG FINAL PARA BAIXAR` com ícone de download não baixa (`:4113` renderiza). Esse é real.

**O segundo suspeito foi verificado e está inocente.** Preview (Worker) e final
(render-server) **usam o mesmo core**: `render.worker.ts:11-20` e `scripts/render-server.ts:7-11`
importam as mesmas cinco funções do `@visant/psd-engine` — `preloadDisplacementMaps`,
`resolveSoTarget`, `replaceLinkedSmartObjects`, `applyHideRules`, `composePsd` — e as
chamam na mesma ordem. A única divergência é o backend de canvas (`OffscreenCanvas` no
worker, node-canvas no servidor). O `Preview Rápido` não mente sobre o resultado.
OBRIGA: nada. Fica registrado para não voltar como suspeita.

**Q16 Quantos pixels verticais até o primeiro dado real?**
Cabeçalho 57px (`:3724`) + preview 4/3 (~250px na largura padrão de 28%) + acordeões.
O primeiro **controle** da arte só aparece depois de tudo isso, e a seção que o contém
tem um cabeçalho de `h-8` com texto de 9px (`:3949-3952`) — quase invisível, e é o único
jeito de reabrir a seção depois de colapsada.
OBRIGA: o cabeçalho de "Sua Arte" ganha altura e contraste de alvo clicável.

**Q17 Onde este elemento VAI FALTAR?**
`faces.length > 0` esconde o bloco de arte inteiro (`:3944`). PSD com smart object mas
sem face editável renderiza normalmente (comentário `:3734-3739` documenta isso e conserta
o input de arquivo) — mas o usuário desse PSD **não tem controle de enquadramento nenhum**,
só o clique no preview. O caso já mordeu uma vez neste arquivo.
OBRIGA: verificar quantos PSDs do acervo caem nesse caso. Se for mais que punhado, a barra
de enquadramento precisa existir fora do `faces.length > 0`.

**Q18 O que isto ensina o usuário a fazer errado?**
Ensina três coisas: (a) que âmbar não quer dizer nada — item 3; (b) que existem dois
botões finais e é preciso decorar qual; (c) que caps é ênfase, então quando algo for
realmente urgente não sobra registro.

**Q26 Quem mantém isto em seis meses, e como descobre que quebrou?**
`page.tsx` tem **4.920 linhas**, e o drawer é ~410 delas coladas no meio. As regras que
sustentam esta tela vivem em comentários longos (`:3734`, `:4018`, `:4058`, `:4070`) —
excelentes, e é a única documentação que existe. Comentário não é trava: o clone de botão
do item 1 nasceu **dentro** de um comentário que explicava por que só pode haver um
primário.
OBRIGA: o drawer sai para `components/MockupDrawer.tsx`, e as regras que são forma
(um primário por rodapé, um controle por estado) viram teste de varredura da árvore, como
já foi feito em `dead-utility-classes`.

### Bloco fixo

**F1 O quanto estamos reinventando a roda?**
Reusado: `ArtFramePanel` (compartilhado com o Scene Maker), `Panel`/`PanelGroup`, `Dialog`,
`Tooltip`, Lottie, `react-easy-crop`, `next/image`.
Escrito à mão sem precisar: o segmented de modo em `ArtFramePanel.tsx:188-210` — três
botões com `title`, estado ativo à mão — enquanto **`src/components/ui/IconSegmented.tsx`
existe**, faz exatamente isso, e já entrega `aria-label` + `aria-pressed` + `Tooltip`
(`IconSegmented.tsx:56-59`). Idem os swatches de fundo (`ArtFramePanel.tsx:227-247`) e os
botões redondos de ação do preview (`page.tsx:3792-3810`), que ignoram `ui/IconButton`.
OBRIGA: trocar por `IconSegmented`. Ganha acessibilidade de graça e mata o item 6 (escala
de press divergente) por consequência.

**F2 Design system consistente?**
`audit:design` zero. Mas: quatro escalas de press (item 6), duas famílias de cinza
(`neutral-*` em `page.tsx`, `zinc-*` em `IconSegmented.tsx:14-21` — a decisão pendente
registrada na memória `ui-primitives-and-audit`), âmbar cru com dois significados (item 3),
e a string `transition-[color,background-color,border-color,box-shadow,opacity,transform]`
copiada **10 vezes** no alvo.
OBRIGA: a transição vira uma utility (`transition-ui`) no `globals.css`. As outras duas
já têm dona.

**F3 Responsivo e otimizado?**
**Telefone está fora de escopo** (decisão do dono, 2026-08-05): o mockup-store é
ferramenta de desktop. A medição de 390px não se aplica e sai do relatório — não como
pendência, como não-requisito. O que continua valendo é o *resize* do próprio painel:
`minSize="22%"` / `maxSize="40%"` (`:3717-3719`), e o rodapé de três botões em `flex gap-3`
(`:4062`) é o candidato a apertar em 22% de uma tela de 1280px (~280px de painel menos
32px de padding). Fundir os dois primários (item 1) resolve isso de lambuja.
Performance: `priority` no `next/image` do preview (`:3759`) para uma imagem que só existe
com o drawer aberto — `priority` fora do LCP disputa banda com quem é LCP.
OBRIGA: tirar o `priority` de `:3759`. Conferir o rodapé no painel em 22% depois da fusão.

**F4 Fluxo progressivo pro ICP?**
ICP: designer/estúdio produzindo peça de cliente. Caminho:
1. acha o mockup no grid → 2. abre o drawer → 3. solta a arte → 4. **preview automático**
(`:2240`, hover-apply) → 5. ajusta enquadramento → 6. render final → 7. baixa.
O "aha" chega no passo 4 e chega **de graça**, sem clique: é o melhor pedaço desta tela e
ninguém escreveu que ele existe. O abandono mora no passo 6→7: dois botões, o verde não
baixa, e o tempo de render não está anunciado em lugar nenhum antes do clique.
OBRIGA: o primário unificado (Q7) resolve 6→7. O passo 4 merece ser dito.

**F5 O que esconder, compactar ou virar ícone?**

| Ação | Elemento | px verticais |
|---|---|---|
| esconder | `Camadas de ajuste` (`:3903`) → "Detalhes do PSD" | ~52 |
| esconder | linha arquivo/MB/px (`:3935`) → mesmo bloco | ~40 |
| compactar | triângulo lowres (`ArtFramePanel.tsx:184`) some, a caixa fica | 0 (tira ruído lateral) |
| compactar | fundir `RENDER FINAL` + `GERAR PNG FINAL` num primário | ~56 |
| compactar | `Preview Rápido` vira link discreto ao lado do primário | ~20 |
| **não esconder** | aviso de baixa resolução | é o único aviso que evita retrabalho de verdade |
| **não esconder** | linha "Preenchendo a superfície / Encaixar" | é o desfazer de uma decisão automática |
| **não virar ícone** | os modos de enquadramento | `Crop`/`Minimize2`/`Maximize2` para *preencher/encaixar/esticar* já são enigma hoje. `Maximize2` = "distorce" não é metáfora de nada. Ou rótulo curto, ou ícone que descreva a ação (memória `no-star-sparkle-icons`). |

Total recuperável acima da dobra: **~170px**, sem tirar nada que decide.

**F6 O que falta para o nível Vale do Silício?**

| # | Item | Estado |
|---|---|---|
| 1 | Teclado alcança toda ação | falta |
| 2 | `focus-visible` em tudo | **falta** (item 10) |
| 3 | Zero salto de layout | feito (overlay sobre o preview, `:3772`) |
| 4 | Otimista com desfazer | n/a |
| 5 | Erro/vazio/carregando distintos | quase (item 9) |
| 6 | Nada mente | **falta** (itens 1, 4; Q11, Q13) |
| 7 | Latência percebida tratada | feito e bem (hover-apply `:2240`, stream de passos) |
| 8 | Movimento do SSoT, <300ms, reduced-motion | parcial (item 6) |
| 9 | Densidade defensável | falta (~170px, F5) |
| 10 | Um primário por superfície | **falta** (item 1) |
| 11 | Default defendido, regra visível | quase (regra no `title`, Q8) |
| 12 | Volta na mesma posição | feito |
| 13 | Copy na voz da casa | falta (item 7, portão `:4353`) |

**As três de maior alavanca por esforço:**
1. **Um primário só** (item 1) — 20 linhas, mata a mentira do rótulo e devolve 56px.
2. **Recorte na superfície de resultado** (Decisão pendente 1) — é o que você sentiu, e é
   o que faz o painel voltar a ter uma coisa grande só.
3. **`focus-visible` no escopo certo** (item 10) — uma linha no `globals.css`.

**Q28 Qual decisão desta auditoria eu vou lamentar em três meses?**
Deixar o drawer dentro de `page.tsx`. Todo item deste relatório é barato de consertar e
caro de manter consertado enquanto essas 410 linhas morarem no meio de 4.920. O clone de
botão nasceu debaixo do comentário que o proibia — é isso que 4.920 linhas fazem.

---

## O que a rodada consertou nos detectores

| Regra | Problema | Conserto | Caso no fixture |
|---|---|---|---|
| extrator de copy | **falso NEGATIVO**: só varria `.tsx`/`.jsx`. `art-classify.ts` devolvia `reason:` com travessão que o painel mandava direto pro olho do usuário, e o portão dizia "copy zero" | `.ts` entra pelo CONTRATO (propriedade que vira texto de tela: `label`, `title`, `reason`, `message`…), nunca o arquivo inteiro | `fixtures/lib-copy-extractor.ts`, novo, 5 EXTRAI e 5 IGNORA |
| `visual:drawer` caps | **falso positivo**: acusava o logotipo do app e `[ MOCKUPS 1.0 ]`, que é nome de estúdio vindo do acervo | varre só rótulo de ação (`button`, `a[href]`); dado do usuário não responde pela voz da casa | — |
| `visual:drawer` foco | **falso positivo**: `el.focus()` programático não casa `:focus-visible` num `<button>`, então acusava ausência de anel que existia | Tab de verdade | — |
| `check:render-failure` | **falso negativo intermitente** (2 de 4): polling perdia o toast, que some em ~4s; e a prévia automática redesabilitava o botão entre a espera e o clique | `MutationObserver` grava todo toast; `disabled` conferido no instante do clique | 4/4 e 3/3 determinístico |

O achado de copy do portão (`page.tsx:4353`) foi confirmado lendo a linha: travessão
real, em texto que chega no olho do usuário.

**Prova de que o buraco do `.ts` fechou:** com o travessão recolocado em
`art-classify.ts:97`, o portão fecha e aponta a linha; removido, abre.

---

## Plano de conserto, em ondas

**Onda 0 — portão (bloqueia tudo)**
- `page.tsx:4353` travessão.

**Onda 1 — a mentira e o berro (não vai pra PR sem)**
- Fundir `RENDER FINAL` + `GERAR PNG FINAL PARA BAIXAR` num primário de estados (itens 1, 7).
- `else` no `:2217` com toast, e toast no `cleanup(err)` do `:2089` (itens 9, 10).
- **A caixa âmbar morre** (item 11 + item 2 + Q11 + Q6 de uma vez) — desenho abaixo.
- Anel de foco: tirar o escopo `.scene-maker` do `globals.css:159`.

### O aviso de resolução, redesenhado

Some a caixa de `page.tsx:4049-4057` **inteira** e some o triângulo duplicado de
`ArtFramePanel.tsx:184-186`. O fato vira um termo na linha que já existe
(`ArtFramePanel.tsx:163-168`), ao lado dos números de que ele fala:

```
antes   [caixa âmbar, 56px, borda + fundo + ⚠ + negrito, 3 linhas]
        ⚠ Arte com 1080×1350 para uma superfície de 1720×2577,
          ampliação de 1.9×. O render vai sair borrado.

depois  [uma linha, 14px, dentro do bloco da arte]
        1080×1350px → superfície 1720×2577 · amplia 1,9×
                                              └── único termo colorido
```

O que isso conserta de uma vez:

| | |
|---|---|
| **intrusão** | 7 sinais viram 1. Devolve ~56px logo acima do primário. |
| **duplicação** (item 2) | um lugar só diz o fato. O triângulo sai. |
| **âmbar com dois sentidos** (item 3) | sobra só o badge PREVIEW usando âmbar — e ele também sai, para neutro. |
| **número que mente** (Q11) | o `1,9×` passa a ser calculado do mesmo `src` que alimenta `isLowRes` (`ArtFramePanel.tsx:81-88`), então recorte apertado aumenta o número em vez de escondê-lo. |
| **peso na coisa errada** (Q6) | o número que decide é o único elemento marcado da linha. |
| **alarme sem saída** (item 8) | a saída vai pro `title`/tooltip do termo: *"Mande uma arte de 1720px de largura, ou use Encaixar."* Quem quiser o conselho passa o mouse; quem já sabe não é interrompido. |

Não some quando o `upscale` é grande: **fica sempre**, e o que muda é a cor do termo
(neutro até ~1,2×, marcado acima disso). Aviso que aparece e some ensina a não confiar na
linha; termo que está sempre lá e às vezes acende é uma régua.

⚠️ **Toca `ArtFramePanel.tsx`, que é compartilhado com o Scene Maker** (`src/app/scene/page.tsx`).
Preciso do seu ok antes de editar, e o `variant="full"` do Scene Maker tem que continuar
com o comportamento de hoje.

**Onda 2 — a organização (a sua queixa)**
- Decisão pendente 1: recorte assume a superfície de resultado.
- `ArtFramePanel` → `IconSegmented` (F1), o que zera a escala de press divergente ali.
- Matar o triângulo duplicado (item 2).

**Onda 3 — densidade e ruído**
- `Camadas de ajuste` + linha de arquivo → "Detalhes do PSD" (F5, ~92px).
- Âmbar: um significado só; o badge PREVIEW vira neutro (item 3).
- Barra de 40% sai; fica o contador (item 4).
- `transition-ui` como utility; `priority` fora do `:3759`.

**Onda 4 — manutenção**
- `MockupDrawer.tsx` sai do `page.tsx`.
- Teste de varredura: um primário por rodapé, um controle por estado.

Nota projetada ao fim da onda 2: **86/100**. Ao fim da onda 3: **94/100**.

---

## Proposta de gosto (você escolhe linha por linha)

| Onde | Antes | Depois |
|---|---|---|
| `:4084` | `RENDER FINAL` | `Gerar PNG` |
| `:4104` | `DOWNLOAD PNG` | `Baixar PNG` |
| `:4116` | `GERAR PNG FINAL PARA BAIXAR` | *(deixa de existir — vira o mesmo primário)* |
| `:4068` | `Preview Rápido` | `Prévia` |
| `:3777` | `compositing…` | `Compondo…` |
| `:4053` | `Arte com 1080×1350 para uma superfície de 1720×2577, ampliação de 1.9×. O render vai sair borrado.` | `Ampliação de **1,9×**. A arte tem 1080×1350 e a superfície pede 1720×2577: o PNG vai sair borrado. Mande uma arte de 1720px de largura, ou use Encaixar.` |
| `:4353` | `Coleção avulsa não precisa de marca — vira o destino do marcador enquanto estiver ativa.` | `Coleção avulsa não precisa de marca. Enquanto estiver ativa, ela é o destino do marcador.` |

---

## Verificação

Rodado, com o dev aquecido na 4100:

| Portão | Resultado |
|---|---|
| `tsc --noEmit` | limpo |
| lint do repo | **0 erros** (warnings pré-existentes, política do repo) |
| vitest | **368/368**, 33 arquivos |
| `killer-scan` no alvo | impeccable 0 · audit:design 0 · copy 0 (248 strings) |
| `killer-scan --self-test` | sem falso positivo, sem falso negativo |
| `visual:home` | **12/12** (1920px e 390px) |
| `visual:console` | 0 erro, 0 aviso, 0 falha de rede |
| `visual:drawer` (novo) | **7/7**, duas rodadas seguidas |
| `check:render-failure A` (novo) | 3/3 — `O render falhou · Failed to fetch` |
| `check:render-failure B` (novo) | 4/4 — `O render falhou · O render terminou sem produzir arquivo…` |
| capturas abertas | `1-sem-arte` · `2-com-arte` · `4-recorte` · `zoom-art-row` |

**Fechado nesta rodada:** preview ≡ final. Mesmo `@visant/psd-engine`, mesmas cinco
chamadas, mesma ordem (`render.worker.ts:11-20` × `scripts/render-server.ts:7-11`); só
muda o backend de canvas. Era a pergunta mais cara em aberto.

**Armadilha que quase virou conclusão errada:** `curl localhost:4200` devolve `000`
porque o render-server fala **TCP puro, não HTTP**. Cheguei a concluir que tinha testado
"com o backend fora" quando ele estava de pé o tempo todo. A falha passou a ser injetada
na resposta, que é o que o navegador de fato vê.

## Não verificado

- **Telefone / 390px do painel.** Fora de escopo por decisão do dono: o mockup-store é
  ferramenta de desktop. (O `visual:home` mede 390px porque já media.)
- **Render-server realmente derrubado.** As falhas são injetadas na resposta. O caminho
  `res.ok === false` (`:2183`), que já existia e já toastava, continua não exercitado.
- **`prefers-reduced-motion`.** Nenhuma das transições foi conferida com o sistema
  pedindo menos movimento.
- **Onda 4.** O drawer segue dentro das 4.920 linhas do `page.tsx`, e a regra "um
  primário por rodapé" está travada por portão visual, não por teste de árvore.
