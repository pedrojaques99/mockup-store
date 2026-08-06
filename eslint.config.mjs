import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /* O AGENTS.md manda medir memória em modo produção com um `distDir` próprio
     * (`NEXT_DIST_DIR=.next-prod npx next build`), justamente pra não brigar com o
     * dev aberto. Só que o default do eslint-config-next ignora `.next/**` e mais
     * nada, então bastava alguém seguir o manual para o `npm run lint` passar a
     * varrer o BUNDLE: medido em 06/08/2026, 1.282 erros e 23.326 warnings, todos
     * em código gerado. A política do repo é zero erro, então o portão inteiro
     * vira ruído e para de significar coisa alguma.
     * Qualquer `.next*` é saída de build e nunca é código-fonte. */
    ".next-*/**",
  ]),
  // Política de severidade — `tsc --noEmit` é o gate de type-safety (roda no CI).
  // Aqui o lint trava só nos erros que o compilador NÃO pega; o resto fica `warn`
  // (visível, não-bloqueante) pra não barrar o pipeline com ruído pragmático:
  //   - no-explicit-any: usado de propósito em glue/workers/limites MCP; tsc cobre o resto.
  //   - react-hooks/* (refs, set-state-in-effect, static-components, immutability):
  //     regras novas e heurísticas do plugin, alto índice de falso-positivo em código válido.
  //   - no-require-imports: scripts/workers que legitimamente usam require().
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
