import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "tests/e2e/.report/**",
      "tests/e2e/.results/**",
      "public/**",
      ".worktrees/**",
    ],
  },
  {
    // Playwright fixtures, not React: a function's `use` parameter (Playwright's
    // fixture-provider callback) matches the react-hooks plugin's naming
    // heuristic for a Hook, which misfires here.
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default eslintConfig;
