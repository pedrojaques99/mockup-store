# Killer — Painel de Configurações

**Alvo:** `src/components/ConfigPanel.tsx`, `src/app/api/config/**`, o diálogo em `src/app/page.tsx`
**Data:** 06/08/2026
**Tier:** T2 (tela com estados) com **região T3** na aba Chaves, porque credencial é identidade

## Nota: 88/100

Portão limpo nos três detectores, T3 interrogado, dois defeitos reais achados e
consertados. Não chega a 95 porque duas verificações ficaram em aberto (abaixo).

## Portão

| Detector | Antes | Depois |
|---|---|---|
| `impeccable` (tell de IA) | zero | zero |
| `audit:design` (token) | zero | zero |
| copy (vício de linguagem) | **3 achados** | zero (35 strings de interface) |
| `tsc` | limpo | limpo |
| lint | 0 erros | 0 erros |
| `ui:audit` | dentro do teto | dentro do teto |
| testes | 455 | 455 |

Extrator de copy validado por `--self-test` antes de confiar no zero.

### Os 3 achados de copy, confirmados linha a linha

Nenhum falso positivo. Eram copy minha, visível na tela:

| Linha | Vício | Era |
|---|---|---|
| 182 | bolinha separadora | `· configuração em {arquivo}` |
| 264 | travessão | `Cada uma liga uma parte do app — nenhuma é obrigatória.` |
| 339 | ponto-e-vírgula | `navegar funciona; renderizar não.` |

## Dois defeitos que só o olho pegou

### 1. Zero silencioso no contador do acervo (consertado)

O painel escrevia **"0 no grid"** com o grid cheio de cards atrás.

Causa: o cache do catálogo é **por worker**. A requisição do painel caiu num
worker frio, onde `indiceMontado: false` e `visiveis: 0`. Medido:
`/api/config` devolvia `{total: 5941, visiveis: 5869}` num worker quente e
`{docs: 0, indiceMontado: false}` noutro, ao mesmo tempo.

É a mentira dominante que o protocolo de verificação nomeia: zero que veio de
falha é indistinguível de zero verdadeiro. A API agora manda `montado`, e sem o
índice montado a tela **não escreve número nenhum**, escreve que está montando.

### 2. Rodapé competindo com o conteúdo (consertado)

"Duplicatas" era rodapé fixo do diálogo, presente em toda rolagem, sendo uma
ação de manutenção que quase ninguém usa. Passou a viver na aba Avançado.

Antes disso ele **sobrepunha** o painel (`dupTop 838` contra `painelBottom 817`)
porque o flex item não tinha `min-h-0` e adotava a altura do conteúdo.

## Julgamento

**Superfície:** C (confiança) na aba Chaves, B (trabalho) no resto. Não é A.

**Cut test.** Cada elemento nomeia a variável que move:

| Elemento | Variável | Fica? |
|---|---|---|
| Pastas do acervo | tamanho do grid, que é o produto | sim, e é a aba padrão |
| Bolinha verde/amarela por pasta | "por que meu acervo encolheu" | sim, é o diagnóstico mais pedido |
| Chave por provedor | quais recursos ligam | sim |
| Link "pegar chave da X" | conversão do BYOK | **sim, era o passo que travava** |
| Botão Testar | confiança antes de gastar crédito | sim |
| Caminho do `config.json` | edição manual, caso raro | rebaixado para o fim da aba Avançado |
| Duplicatas | manutenção | movido para Avançado |

**Abas, e por quê.** A versão anterior era uma coluna só. As sete chaves
empurravam o acervo para fora da primeira tela, sendo o acervo a única
configuração que muda o que aparece no grid. Ordem: Acervo, Conta, Chaves,
Avançado, do mais comum ao mais raro.

**Reuso.** Nenhum primitivo novo. As abas são o `Segmented` que já existia, e o
diálogo é o `Dialog` do Radix da casa.

**Conta Visant.** Device flow, reusando as rotas que já existiam
(`POST /api/auth/visant`, `poll`, `me`, `logout`) — as mesmas que a home usa
para conectar marca. Ganhou uma guarda que a home não tem: `vivo.current`
interrompe o polling se o painel fechar no meio, senão a promessa continuaria
gravando estado em componente desmontado.

## Verificação

| Checagem | Resultado |
|---|---|
| tipos e lint | limpos |
| estouro a 1920px | 0px, nada fora do diálogo |
| **estouro a 390px** | **0px, nada fora do diálogo** |
| dado real | acervo real, 3 pastas, 3 chaves definidas |
| **backend parado** | mostra "Não consegui ler a configuração"; **não vaza SyntaxError** |
| capturas abertas | sim, as 4 abas (foi assim que o zero silencioso apareceu) |

## O que ficou em aberto

1. **Feel (DevTools a 25%) não foi medido.** As transições são as da casa
   (`transition-ui`), mas a troca de aba não foi observada em câmera lenta.
2. **Teclado não foi percorrido.** `focus-visible` alcançando tudo que o hover
   revela continua por verificar.
3. **Paridade `contarDimensoes` mongo × local** estourou 10 minutos e não
   concluiu. As duas implementações ainda não foram provadas equivalentes.

## Decisão pendente para o usuário

**A aba Conta deveria ser a primeira quando não há ninguém logado?** Hoje o
padrão é sempre Acervo. Para quem já tem marca na Visant, entrar traz paleta e
logo prontos e é o caminho mais curto até um mockup útil; para quem só quer
plugar PSDs, Conta é ruído. Minha recomendação é **manter Acervo como padrão** e
deixar a Conta ganhar um ponto verde no rótulo quando conectada, porque o acervo
vazio é o problema de 100% dos instaladores e a marca é de uma fração deles.
