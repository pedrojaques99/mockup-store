# Instalar na sua máquina

Para o time (que já tem o acervo) e para quem vai usar o app com os próprios
PSDs. São 4 passos e nenhum deles pede banco de dados.

## 1. Instalar

```bash
git clone https://github.com/pedrojaques99/mockup-store.git
cd mockup-store
npm ci
npm run setup
```

Precisa de **Node 22 ou mais novo**. Só isso.

O `npm run setup` pergunta onde estão os seus PSDs e quais chaves você tem.
Pode dar Enter em tudo — nada é obrigatório, e tudo é editável depois na
**engrenagem** dentro do app.

## 2. Apontar o acervo

Aqui está a única coisa que muda de máquina para máquina: **a letra do drive**.

Você monta o acervo onde quiser (`Z:`, `Y:`, `D:\Trabalho`, Google Drive
Desktop, o que for). Só precisa dizer onde. Duas formas, escolha uma:

- no `npm run setup`, quando ele perguntar;
- no app: engrenagem → **Pastas do acervo** → colar o caminho → Adicionar.

Não precisa combinar letra com ninguém. O catálogo guarda o caminho como
`{acervo}/…` e reata com a sua pasta na leitura.

## 3. Importar o acervo já indexado *(só o time)*

Quem tem o acervo BOXY recebe um arquivo `catalog-seed.json.gz`. Ponha em
`data/` e rode:

```bash
npm run seed:import
```

Isso traz os 9 mil registros **com as faces e smart objects já extraídos**.
Reindexar não é copiar linha: é abrir cada PSD. O seed poupa esse trabalho.

Conferir depois: `npm run seed:status`.

> Quem gera o seed (uma vez, na máquina que tem o Mongo): `npm run seed:export`.

## 4. Rodar

```bash
npm run dev      # http://localhost:3000
npm run render   # noutra aba, se for renderizar (precisa do bun)
```

---

## Chaves (BYOK)

Ficam **na sua máquina**, em `data/config.json`. Nenhuma sai daqui, e nenhuma é
obrigatória — cada uma liga um pedaço:

| Chave | Liga |
|---|---|
| OpenAI | geração de imagem |
| Gemini | detecção assistida de superfície |
| Anthropic | análise de cena |
| Replicate | segmentação, profundidade, reluz e upscale |
| Visant Labs | lotes por marca (brand kit) |

Engrenagem → **Suas chaves** → colar → **Salvar** → **Testar** (o teste bate no
provedor sem gastar crédito).

O painel mostra só a máscara (`sk-p••••••0twA`). O valor em claro não volta para
a tela — quem desconfia de uma chave troca, não confere.

**Se o campo aparecer travado** dizendo *"definido no .env.local"*: essa chave
está fixada no arquivo de ambiente, e o arquivo vence o painel. Apague a linha
do `.env.local` para poder editar pela tela.

## Perguntas que aparecem sempre

**Preciso de MongoDB?** Não. O catálogo mora num arquivo local
(`data/catalog.sqlite`). O Mongo só entra se você definir `MONGODB_URI` —
é o modo de quem opera o acervo central.

**Meu acervo sumiu do grid.** Quase sempre é a pasta apontando para o lugar
errado. Engrenagem → Pastas do acervo: pasta com bolinha **amarela** é pasta que
não existe nesta máquina.

**Posso mudar a pasta depois?** Pode, a qualquer momento, pela engrenagem. O
catálogo é reconstruído sozinho.
