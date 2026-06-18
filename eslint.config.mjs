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
