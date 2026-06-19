# PLAN — Projeto como arquivo local `.vsn`

## Problema (raiz)
No photo-mockup, **máscara, luz, fx, geometria** vivem todos no `editorDoc`
(`useDocField`), não em `useState` local. O fluxo de "novo projeto" (`resetPhoto`)
e "foto nova" (`handlePhotoFile`, ramo `!preserve`) zerava só UI states soltas + o
`quad` — o `doc` inteiro do projeto anterior **vazava** pra cena nova.

### Fix da raiz (feito)
`useEditorDoc.getState().resetDoc()` chamado nos dois pontos →
cada projeto começa do `DEFAULT_DOC` limpo. Sem isto nenhum salvamento resolveria,
porque a separação acontece em memória, não no disco.

## Separação real = um arquivo por projeto: `.vsn`
`.psd` é incoerente aqui (não é raster em camadas do Photoshop; escrever um writer
PSD seria reinventar a roda). Formato coerente = **bundle zip** com tudo embutido,
portátil entre máquinas.

```
projeto.vsn  (zip — fflate, lib validada ~8kB)
 ├─ project.json   ← { v, doc: DocState, imgDims, tool, name, savedAt }
 ├─ photo.png      ← foto original (a fonte; render é derivado)
 └─ thumb.jpg      ← preview pra galeria/OS (opcional)
```

## Implementação
- **`src/lib/project-file.ts`** (puro, sem DOM):
  - `packProject({ doc, imgDims, tool, name, photoBytes, thumbBytes? }) → Uint8Array`
  - `unpackProject(bytes) → { doc, imgDims, tool, name, photoBytes }`
  - `zipSync`/`unzipSync` do fflate. Valida schema (`v`) e shape do doc.
- **`page.tsx`**:
  - `saveProject()` → fetch da foto (`/asset/photo`) como blob, gera thumb via canvas,
    `packProject`, baixa `<nome>.vsn` (anchor download — sem lib extra).
  - `openProject(file)` → `unpackProject`, `resetDoc(doc)`, depois
    `handlePhotoFile(photoFile, { quad: doc.quad })` (reusa a máquina de upload no
    modo `preserve` — sobe a foto, mantém o doc importado, não remonta o viewer).
  - Botões **Salvar** / **Abrir** ao lado de "Novo projeto" no header.

## Não-objetivos (anti-overkill)
- Sem galeria multi-slot no navegador (arquivo no disco já dá portabilidade).
- Sem versionamento/merge — é snapshot. `v` no json cobre migração futura.
- Render NÃO entra no bundle (é derivado da foto + doc; recomputável).
