// Flat config. Type-aware rules are on, because the codebase already runs with
// every strict compiler flag and the linter's job is the things `tsc` cannot
// see: an effect with a lie in its dependency list, a module imported twice, a
// promise dropped on the floor. Formatting is Prettier's, not ESLint's.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".wrangler/**", "worker-configuration.d.ts", "tools/artgen/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Three projects, not the project service: the Worker and the tests
        // have their own tsconfigs, and the service only finds the nearest.
        project: ["./tsconfig.json", "./tsconfig.worker.json", "./test/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `tsc` already knows every identifier; this rule only produces noise on TS.
      "no-undef": "off",
      // `import { x }` beside `import type { Y }` from one module is the house
      // style under `verbatimModuleSyntax`; two *value* imports is the mistake.
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      // `void promise` is the codebase's own idiom for "fire and forget on purpose".
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // `noUncheckedIndexedAccess` makes `!` after an index a deliberate, commented act here.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      // Deliberate, and commented where it happens: a boot effect that sets
      // "loading" before its fetch, and a map that resets "failed" when its
      // source changes. The rule exists for the React Compiler; nothing here
      // is compiled.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Node scripts and tooling: plain JS or type-stripped TS, no tsconfig project.
    files: ["scripts/**", "tools/**", "*.config.{js,ts,mjs}", "eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        performance: "readonly",
        setTimeout: "readonly",
      },
    },
  },
);
