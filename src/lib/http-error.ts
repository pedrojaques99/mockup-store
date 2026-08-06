/**
 * A mensagem de uma resposta que falhou — sem estourar dentro do parser.
 *
 * Defeito real, medido em 06/08/2026 no `Gerar PNG`: `await res.json()` num
 * `if (!res.ok)` estoura quando o corpo vem VAZIO, e o `catch` de fora mostra
 * `SyntaxError: Unexpected end of JSON input`. O usuário lê a mensagem do PARSER
 * no lugar da mensagem do problema — e vai caçar o bug no lugar errado.
 *
 * Corpo de erro vazio não é caso exótico: é o que o Next devolve para QUALQUER
 * exceção não tratada dentro de um route handler (foi assim que apareceu — arte
 * acima do teto de corpo chegava truncada e derrubava o handler antes de ele
 * conseguir responder). Proxy, timeout de gateway e conexão cortada no meio dão
 * o mesmo corpo vazio.
 *
 * Aqui a ordem é a inversa da que causa o estrago: primeiro texto, depois
 * tentativa de JSON, e o status como último recurso — porque o status é a única
 * coisa que existe em toda resposta.
 *
 * Uso:
 *   if (!r.ok) throw new Error(await readError(r));
 *   const d = await r.json();          // parse do SUCESSO, depois do portão
 *
 * A ordem importa: `Response.json()` e `Response.text()` consomem o corpo, então
 * ler para o erro ANTES do `ok` gasta o corpo do sucesso.
 *
 * Guarda de varredura: `src/lib/__tests__/error-body-parse.test.ts`.
 */

/** Corpo de erro grande é log, não mensagem: o toast trunca em ~2 linhas. */
const MAX = 200;

export async function readError(res: Response, fallback?: string): Promise<string> {
  const raw = await res.text().catch(() => "");
  const txt = raw.trim();

  if (txt) {
    let ehJson = false;
    try {
      const parsed = JSON.parse(txt) as { error?: unknown; message?: unknown };
      ehJson = true;
      const msg = typeof parsed.error === "string" ? parsed.error
        : typeof parsed.message === "string" ? parsed.message
        : "";
      if (msg.trim()) return msg.trim().slice(0, MAX);
    } catch {
      // Corpo que não é JSON ainda pode ser mensagem (texto puro de um proxy).
    }
    /* Duas coisas que NÃO são mensagem e nunca vão para a tela:
     *   - JSON que parseou mas não tem campo de texto. Despejar `{"ok":false}`
     *     num toast é mostrar o payload para quem não faz ideia do que ele é;
     *   - HTML. A página de erro do dev server tem centenas de linhas de markup.
     * Nos dois casos o status diz mais, em menos. */
    if (!ehJson && !txt.startsWith("<")) return txt.slice(0, MAX);
  }

  return fallback || `HTTP ${res.status}`;
}
