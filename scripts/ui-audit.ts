/**
 * ui-audit — o placar da UI, medido, repetível e com orçamento.
 *
 * Nasceu de uma auditoria feita à mão cujos números envelheceram no mesmo dia em
 * que foram escritos (`docs/AUDIT-nivel-vale.md`). Métrica que só existe num
 * documento não é métrica: é uma foto. Isto roda em 1s, sempre diz a verdade do
 * momento e **falha** quando um orçamento é estourado — que é o que impede o gap
 * de voltar depois de fechado.
 *
 *   npm run ui:audit          placar + veredito
 *   npm run ui:audit -- --list <chave>   onde estão as ocorrências
 *
 * Os tetos estão FIXADOS no valor alcançado — não sobra folga. Zero significa
 * fechado; um número significa "isto ainda não migrou, e não pode crescer".
 * Nunca suba um teto sem escrever o motivo ao lado.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname, relative } from "path";

const SRC = "src";
const ROOT = process.cwd();

interface Hit { file: string; line: number; text: string }
interface Metric {
  key: string;
  label: string;
  /** Teto atual. Estourou ⇒ o comando falha. */
  budget: number;
  /** Nota curta que explica por que a métrica existe. */
  why: string;
  hits: Hit[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "__tests__") continue;
      walk(p, out);
    } else if ([".tsx", ".ts"].includes(extname(p))) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
// `split("\n")` deixa um `\r` no fim de cada linha (o repo é CRLF) e qualquer
// regex ancorada em `$` passa a nunca casar, em silêncio.
const SOURCES = FILES.map((f) => ({ file: relative(ROOT, f), lines: readFileSync(f, "utf-8").split(/\r?\n/) }));

/** Linha que é só comentário — não é código e não pode contar como ocorrência. */
const isComment = (l: string) => /^\s*(\{?\/\*|\/\/|\*)/.test(l);

/** Conta ocorrências de um regex por linha, com endereço. */
function scan(re: RegExp, filter?: (file: string, line: string) => boolean): Hit[] {
  const out: Hit[] = [];
  for (const { file, lines } of SOURCES) {
    lines.forEach((text, i) => {
      if (isComment(text)) return;
      if (filter && !filter(file, text)) return;
      const m = text.match(new RegExp(re.source, re.flags.replace("g", "") + "g"));
      if (m) for (let k = 0; k < m.length; k++) out.push({ file, line: i + 1, text: text.trim().slice(0, 120) });
    });
  }
  return out;
}

/**
 * Um `<button>` inteiro, de `<button` até `</button>`, atravessando linhas.
 *
 * A primeira versão desta métrica olhava só uma janela de 6 linhas e testava
 * "tem `>` seguido de letra" — o que marcava como MUDO todo botão cujo rótulo
 * caía depois da janela, e apontou 68 falsos positivos. Um detector que grita
 * lobo é pior que detector nenhum: gera trabalho em cima de defeito inexistente
 * e ensina a ignorar o placar.
 */
function buttonBlocks(lines: string[]): { start: number; html: string }[] {
  const out: { start: number; html: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/<button(?=[\s>]|$)/.test(lines[i]) || isComment(lines[i])) continue;
    let depth = 0, html = "";
    for (let j = i; j < Math.min(lines.length, i + 60); j++) {
      html += lines[j] + "\n";
      depth += (lines[j].match(/<button(?=[\s>]|$)/g) ?? []).length;
      depth -= (lines[j].match(/<\/button>/g) ?? []).length;
      if (depth <= 0 && j > i) break;
      if (/\/>\s*$/.test(lines[j]) && j === i) break;
    }
    out.push({ start: i + 1, html });
  }
  return out;
}

/**
 * O botão é MUDO? Só responde `true` quando dá para provar.
 *
 * Duas tentativas anteriores erraram por excesso de regex: a primeira olhava uma
 * janela de 6 linhas e acusou 68 falsos positivos; a segunda tentou remover as
 * props com regex e passou a comer o próprio rótulo, subindo para 22. Um detector
 * que grita lobo gera trabalho sobre defeito inexistente e ensina a ignorar o
 * placar — então a regra agora é conservadora de propósito:
 *
 *   mudo := conteúdo interno sem nenhum texto E sem nenhuma expressão `{…}`
 *
 * Rótulo dinâmico (`{preset.name}`, `{cond ? "A" : "B"}`) é indecidível daqui,
 * e indecidível **não é** acusação. Esses passam; o custo é um falso negativo,
 * que é o erro barato.
 */
function isMute(html: string): boolean {
  const open = html.indexOf(">");
  const close = html.lastIndexOf("</button>");
  if (open < 0 || close < 0 || close < open) return false;
  const inner = html.slice(open + 1, close);
  if (inner.includes("{")) return false;             // rótulo dinâmico — não dá para provar
  const semTags = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return semTags.length === 0;
}

const isUi = (f: string) => f.includes("components") || f.includes("app");
const isPrimitive = (f: string) => f.replace(/\\/g, "/").includes("src/components/ui/");

const METRICS: Metric[] = [
  {
    key: "modal-a-mao",
    label: "Modais escritos à mão (`fixed inset-0 z-`)",
    budget: 0,
    why: "sem foco preso, sem trava de rolagem, sem restaurar foco. Use ui/Dialog.",
    hits: scan(/fixed inset-0 z-/, (f) => !isPrimitive(f) && !f.includes("DropOverlay")),
  },
  {
    key: "switch-a-mao",
    label: "Switches escritos à mão",
    budget: 0,
    why: "sem role=switch e cada um com uma medida. Use ui/Switch.",
    hits: scan(/rounded-full relative transition|absolute top-0\.5 w-[23](\.5)? h-[23](\.5)? rounded-full bg-white/, (f) => !isPrimitive(f)),
  },
  {
    key: "select-nativo",
    label: "`<select>` nativo",
    budget: 0,
    why: "a lista é desenhada pelo SO — nenhum CSS alcança. Use ui/Select.",
    hits: scan(/<select\b/, (f) => !isPrimitive(f)),
  },
  {
    key: "duracao-hardcoded",
    label: "Duração hardcoded numa transição",
    budget: 0,
    why: "existe SSoT em --dur-*. (`animate-in duration-*` é legítimo e não conta.)",
    hits: scan(/duration-\d+/, (f, l) => !isPrimitive(f) && /transition/.test(l) && !/animate-(in|out)/.test(l)),
  },
  {
    key: "transition-all",
    label: "`transition-all`",
    budget: 0,
    why: "anima propriedades não intencionais e janka; declare o que muda.",
    hits: scan(/transition-all/),
  },
  {
    key: "raio-fora-da-escala",
    label: "Raio fora da escala (`sm`/`md`/`3xl`)",
    budget: 7,
    why: "escala da casa: lg=controle, xl=cartão, 2xl=painel/modal, full=pílula.",
    hits: scan(/rounded-(sm|md|3xl)\b/, (f) => isUi(f)),
  },
  {
    key: "paleta-misturada",
    label: "Arquivo que mistura `zinc` e `neutral`",
    budget: 0,
    why: "são cinzas diferentes; zinc é a pele do editor, neutral a da loja.",
    hits: SOURCES.filter(({ file, lines }) => {
      if (!isUi(file) || isPrimitive(file)) return false;
      const s = lines.join("\n");
      return /\bzinc-/.test(s) && /\bneutral-/.test(s);
    }).map(({ file }) => ({ file, line: 1, text: "mistura zinc + neutral" })),
  },
  {
    key: "botao-icone-a-mao",
    label: "Botão só-ícone escrito à mão",
    budget: 12,
    why: "ui/IconButton dá tooltip + aria-label obrigatórios e tamanho único.",
    // Preciso, não por palpite de className: o corpo do botão é UM elemento e
    // esse elemento é um ícone (`<Nome ... />` em PascalCase, sem texto irmão).
    hits: (() => {
      const out: Hit[] = [];
      for (const { file, lines } of SOURCES) {
        if (!isUi(file) || isPrimitive(file)) continue;
        for (const { start, html } of buttonBlocks(lines)) {
          const open = html.indexOf(">"), close = html.lastIndexOf("</button>");
          if (open < 0 || close < 0 || close < open) continue;
          const inner = html.slice(open + 1, close).trim();
          // Estrutural, sem ancora `$` — que ja falhou em silencio uma vez: o corpo
          // tem exatamente UMA tag, auto-fechada e comecando em maiuscula = icone.
          const tags = inner.match(/</g)?.length ?? 0;
          const soIcone = tags === 1 && /^<[A-Z]/.test(inner) && inner.trimEnd().endsWith("/>");
          if (soIcone) out.push({ file, line: start, text: lines[start - 1].trim().slice(0, 120) });
        }
      }
      return out;
    })(),
  },
  {
    key: "sem-aria-label",
    label: "Botão sem texto e sem `aria-label`/`title`",
    budget: 0,
    why: "botão mudo é inalcançável por leitor de tela.",
    hits: (() => {
      const out: Hit[] = [];
      for (const { file, lines } of SOURCES) {
        if (!isUi(file) || isPrimitive(file)) continue;
        for (const { start, html } of buttonBlocks(lines)) {
          if (/aria-label=|title=/.test(html)) continue;
          // `<IconButton>`/`<Tooltip>` internos já garantem o nome.
          if (/<(IconButton|Tooltip|DialogClose)/.test(html)) continue;
          if (!isMute(html)) continue;
          out.push({ file, line: start, text: lines[start - 1].trim().slice(0, 120) });
        }
      }
      return out;
    })(),
  },
];

// ---------------------------------------------------------------- saída

const listKey = process.argv.includes("--list") ? process.argv[process.argv.indexOf("--list") + 1] : null;

if (listKey) {
  const m = METRICS.find((x) => x.key === listKey);
  if (!m) {
    console.error(`chave desconhecida: ${listKey}\ndisponíveis: ${METRICS.map((x) => x.key).join(", ")}`);
    process.exit(2);
  }
  console.log(`\n${m.label} — ${m.hits.length} ocorrência(s)\n`);
  const byFile = new Map<string, Hit[]>();
  for (const h of m.hits) (byFile.get(h.file) ?? byFile.set(h.file, []).get(h.file)!).push(h);
  for (const [file, hits] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${hits.length})`);
    for (const h of hits.slice(0, 8)) console.log(`      ${String(h.line).padStart(5)}  ${h.text}`);
    if (hits.length > 8) console.log(`      … +${hits.length - 8}`);
  }
  process.exit(0);
}

let estourou = 0;
console.log("\n  UI AUDIT — placar da casa\n");
console.log(`  ${"métrica".padEnd(44)} ${"agora".padStart(6)} ${"teto".padStart(6)}`);
console.log(`  ${"─".repeat(44)} ${"─".repeat(6)} ${"─".repeat(6)}`);
for (const m of METRICS) {
  const n = m.hits.length;
  const ok = n <= m.budget;
  if (!ok) estourou++;
  console.log(`  ${(ok ? "  " : "✗ ") + m.label.padEnd(42)} ${String(n).padStart(6)} ${String(m.budget).padStart(6)}`);
  if (!ok) console.log(`     └ ${m.why}`);
}
console.log(`\n  Detalhe: npm run ui:audit -- --list <${METRICS.map((m) => m.key).join("|")}>\n`);

if (estourou) {
  console.error(`  ${estourou} métrica(s) acima do teto.\n`);
  process.exit(1);
}
console.log("  Tudo dentro do orçamento.\n");
