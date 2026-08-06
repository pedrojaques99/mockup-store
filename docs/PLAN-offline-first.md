# PLAN — offline-first, shipável ao público

> Objetivo: o app deixa de exigir Mongo, chave em arquivo e letra de drive
> combinada, e passa a ser **baixar, apontar a pasta, usar**. O time entra pelo
> mesmo caminho, com o acervo já indexado, sem reextrair nada.

## O problema, medido

Levantado no banco real em 06/08/2026:

| | |
|---|---|
| `community_presets` | 5.892 docs |
| `psd_metadata` | 3.100 docs |
| Caminho gravado | `Z:/BOXY/Produtos/A5 Paper/A5 Paper Mockup - v1.psd` |
| Arquivos que importam `getDb` | **9** |
| Chaves lidas de `process.env` | 6 provedores + 3 de infra |

Três travas, e elas são a mesma trava vista de ângulos diferentes:

1. **O caminho é absoluto, com letra de drive.** Quem montar o acervo em `Y:`
   vê o catálogo encolher — e encolher **calado**, porque o `psd-presence`
   esconde registro cuja pasta sumiu. Sem erro na tela.
2. **Ingest exige Mongo.** Sem `MONGODB_URI` o catálogo lê o disco, mas
   ingerir e publicar respondem 500. Um app público não pode pedir um cluster.
3. **Chave é arquivo + reboot.** `OPENAI_API_KEY` e companhia saem de
   `process.env`: para trocar uma chave, editar `.env.local` e reiniciar.

## A ideia que resolve as três

Guardar **raiz + caminho relativo** em vez de absoluto:

```
antes:  Z:/BOXY/Produtos/A5 Paper/A5 Paper Mockup - v1.psd
depois: {acervo}/A5 Paper/A5 Paper Mockup - v1.psd   + acervo=Z:/BOXY/Produtos (local)
```

Com isso o mesmo registro serve qualquer máquina, e aí o resto cai:

- O time recebe um **seed** exportado do Mongo (faces e smart objects já
  extraídos — a parte cara), aponta a pasta dele e o acervo acende inteiro.
  Zero reindexação.
- O público plugga a pasta *dele* pelo mesmo mecanismo.
- O banco pode ser SQLite local, porque não há mais nada de máquina-específico
  gravado dentro dele.

## Fases

### Fase 1 — Caminho relativo (`src/lib/psd-roots.ts`)

- `toPortable(abs)` → `{acervo}/rel` casando com a raiz mais longa do `PSD_DIRS`.
- `toLocal(portable)` → absoluto pela config da máquina.
- **Leitura tolerante**: caminho absoluto antigo continua funcionando. Os 9 mil
  docs existentes não podem quebrar, e a migração não pode ser pré-requisito.
- Fallback por `fileName` dentro das raízes quando a resolução falha — é o que
  o `psd:repoint` já faz, virando biblioteca.
- Testes cobrindo: raiz mais longa vence, formato antigo passa, caminho fora de
  toda raiz continua absoluto (e é honesto sobre isso).

### Fase 2 — Driver duplo no `getDb`

- `db.ts` vira interface. SQLite (`better-sqlite3`) é o **default**; Mongo entra
  só quando `MONGODB_URI` existe.
- Os 9 consumidores falam com a interface, não com o driver.
- Ganho imediato: **ingest e publicar param de responder 500 sem Mongo** — que é
  o que hoje impede o app de ser público.

### Fase 3 — Seed do acervo

- `npm run seed:export` — Mongo → `catalog-seed.json.gz` com caminhos portáteis.
- `npm run seed:import` — seed → SQLite local, casando `{acervo}` com a pasta da
  máquina.
- Idempotente e retomável. Item cujo arquivo não existe localmente entra
  marcado, não some calado.

### Fase 4 — BYOK + painel de configuração

- `data/config.json` (gitignored) vira a fonte local de chaves e pastas.
- **Precedência: `process.env` vence.** Quem já tem `.env.local` não muda de
  comportamento. Mas o painel **mostra de onde o valor vem** e desabilita a
  edição do que está travado no env — o modo de falha proibido aqui é o silencioso
  (editar no painel, nada acontecer, nenhum aviso).
- Chave **nunca volta para o cliente**: a API devolve máscara + origem, nunca o
  valor. Teste de conexão roda no servidor.
- Painel cobre: pastas do acervo, chaves por provedor com teste, render-server.

### Fase 5 — Instalador scriptado

- `npm run setup` passa a ser interativo quando há TTY: pergunta a pasta do
  acervo, oferece importar o seed, coleta as chaves. Sem TTY (CI) segue mudo e
  idempotente como hoje.
- `SETUP-TIME.md` com o passo a passo do time.

### Fase 6 — Portão de ship

- `tsc` + `lint` + testes + build.
- **Smoke com ZERO env** — é o que prova o offline-first, não o discurso.
- Teste que prova o seed acendendo o acervo numa raiz diferente sem reindexar.
- Visual do painel de config.

## Decidido, para não redecidir

- **Repo é o mesmo.** O que garante o WYSIWYG é ter um core de render só
  (`photo-render-core.ts`); repo novo o duplica e ele diverge — já aconteceu
  neste projeto e está documentado no `AGENTS.md`.
- **Uma config, um lugar.** Nada de cópia em `userData` espelhando o repo: a
  cópia diverge nos dois sentidos, e isso já custou caro no `jaques-os`.
- **Assinatura do Windows fica para depois.** O Azure Trusted Signing não
  atende o Brasil (EUA/Canadá/UE/RU), e certificado EV é caro. Clone + script
  não passa por SmartScreen nenhum. Electron vira casca depois, com dado sobre
  quanta gente travou — e sem tocar no produto.
