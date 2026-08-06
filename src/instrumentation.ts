/**
 * Boot do servidor — carrega a configuração local para dentro do processo.
 *
 * Sem isto o painel BYOK seria decorativo. O app lê chave de `process.env` em
 * dezenas de pontos, e boa parte deles nem é código nosso: os SDKs da OpenAI,
 * Anthropic e Replicate leem a variável sozinhos, na hora em que o cliente é
 * construído. Não há como interceptar isso um a um — e reescrever para passar a
 * chave adiante seria mexer em muito código para o mesmo efeito.
 *
 * Então a config entra por onde eles já leem: `process.env`, uma vez, no boot.
 *
 * **Nunca sobrescreve o ambiente.** A precedência (env vence config) é a mesma
 * que o painel mostra na tela; se aqui o arquivo ganhasse, o painel estaria
 * mentindo sobre qual valor está valendo.
 *
 * `register()` é o gancho do Next para isso e roda uma vez por processo.
 *
 * ⚠️ O `if (=== "nodejs")` com o import DENTRO dele não é estilo: é o que faz o
 * build passar. Este arquivo também é compilado para o runtime Edge, onde `fs`
 * e `path` não existem, e o webpack resolve o import estaticamente — a guarda
 * em runtime chega tarde demais. Só nesta forma (positiva, com o import no
 * corpo do `if`) o bundler elimina o ramo antes de tentar resolvê-lo. Escrito
 * como `if (!== "nodejs") return`, o build quebra com "Can't resolve 'fs'".
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { aplicarConfigNoProcesso, caminhoConfig } = await import("./lib/app-config");
      const { aplicadas } = aplicarConfigNoProcesso();
      if (aplicadas.length) {
        // Diz O QUE entrou, nunca o valor.
        console.log(`[config] ${aplicadas.join(", ")} carregado de ${caminhoConfig()}`);
      }
    } catch (e) {
      // Config quebrada não pode impedir o servidor de subir — o app inteiro
      // funciona sem nenhuma chave, e é assim que ele deve degradar.
      console.error("[config] não carregou:", e instanceof Error ? e.message : e);
    }
  }
}
