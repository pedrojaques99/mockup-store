/**
 * `npm run update` — o caminho alternativo da atualização.
 *
 * O caminho principal é o botão dentro do app (`src/components/Atualizar.tsx`),
 * porque o ICP é designer. Este script existe para dois casos que o botão não
 * cobre: o app não sobe (justamente o momento em que atualizar é mais urgente),
 * e quem prefere terminal.
 *
 * Usa o MESMO núcleo da rota, então as duas portas têm exatamente o mesmo
 * comportamento — inclusive recusar quando há alteração local não commitada.
 * Duas implementações divergiriam no primeiro conserto.
 */
import { estadoUpdate, aplicarUpdate } from "../src/lib/update";

const VERDE = "\x1b[32m";
const AMARELO = "\x1b[33m";
const VERMELHO = "\x1b[31m";
const CINZA = "\x1b[90m";
const OFF = "\x1b[0m";

async function main() {
  console.log("\nProcurando atualização…\n");

  const estado = await estadoUpdate();

  if (estado.erro) {
    console.log(`${VERMELHO}✗${OFF} ${estado.erro}\n`);
    process.exit(1);
  }

  if (!estado.temNovidade) {
    console.log(`${VERDE}✓${OFF} Já está na versão mais nova ${CINZA}(${estado.atualCurto})${OFF}\n`);
    return;
  }

  console.log(
    `${AMARELO}●${OFF} ${estado.atras} atualização(ões) disponível(is) ` +
      `${CINZA}(você está em ${estado.atualCurto})${OFF}\n`
  );
  for (const n of estado.novidades) console.log(`  ${CINZA}·${OFF} ${n}`);
  console.log("");

  if (estado.sujo) {
    console.log(
      `${VERMELHO}✗${OFF} Você tem alteração local não salva no git.\n` +
        `  A atualização parou para não sobrescrever o seu trabalho.\n` +
        `  Rode ${CINZA}git status${OFF} para ver, e commite ou descarte antes.\n`
    );
    process.exit(1);
  }

  console.log("Aplicando…\n");
  const r = await aplicarUpdate();

  for (const p of r.passos) {
    const marca = p.ok ? `${VERDE}✓${OFF}` : `${VERMELHO}✗${OFF}`;
    console.log(`  ${marca} ${p.nome}${p.detalhe ? ` ${CINZA}(${p.detalhe})${OFF}` : ""}`);
  }
  console.log("");

  if (!r.ok) {
    console.log(`${VERMELHO}Não concluiu:${OFF} ${r.erro}\n`);
    process.exit(1);
  }

  console.log(
    `${VERDE}✓ Atualizado.${OFF} Seus PSD, chaves e configurações continuam como estavam.\n` +
      `  Rode ${CINZA}npm run dev${OFF} para subir a versão nova.\n`
  );
}

main().catch((e) => {
  console.error(`\n${VERMELHO}Erro:${OFF}`, e instanceof Error ? e.message : e, "\n");
  process.exit(1);
});
