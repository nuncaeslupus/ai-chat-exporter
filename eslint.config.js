import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  // recommendedTypeChecked, not strictTypeChecked: this is a DOM scraper, and
  // strict's no-unnecessary-condition flags the defensive guards that keep a
  // parser alive when a chatbot ships a DOM the types say is impossible.
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // Error in src: a wrong `!` here ships a TypeError to a user, and there
      // are zero of them left. See the tests/** override below for why the rule
      // is off there rather than warn -- a step that printed 287 warnings on
      // every run was a gate nobody read.
      "@typescript-eslint/no-non-null-assertion": "error",
      // Numbers in templates are unambiguous; the rest of the rule still applies.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Off: its autofix rewrites `||` to `??`, which changes behaviour wherever
      // an empty string or 0 is meant to fall through to the default — the
      // common case in this codebase's rendering paths.
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      // Off: the exporters and the content script implement Promise-returning
      // contracts (BaseExporter.export, the message-listener protocol). The
      // rule cannot see the contract, so every synchronous implementation of
      // one is a false positive.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Off in tests, not warn. The rule exists because in production `!`
      // defers a crash to a confusing place. A test is the opposite: `!` IS
      // the assertion -- if the value is null the test fails immediately, at
      // the line that made the claim, which is the outcome you want.
      //
      // It also fights tsconfig's `noUncheckedIndexedAccess`, which types
      // every `pairs[0]` and `lines[i]` as `| undefined`. Satisfying both would
      // mean a runtime guard around every index read and every optional result
      // field (`result.blob`) in the suite -- 283 of them, all noise.
      // `noUncheckedIndexedAccess` is the stronger, type-checked guarantee;
      // this rule is what gives way.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Parsing runs a console call per message, per node and per artifact, so a
    // `console.log` on these paths costs CPU in a hot loop and pins the logged
    // object (parsed conversation content) in devtools history for as long as
    // it stays open. warn/error on genuine failure paths fire once, off the hot
    // path, so they stay allowed. (Replaces tests/unit/core/no-debug-logging.)
    files: [
      "src/core/services/html-content-parser.ts",
      "src/core/services/claude-api-service.ts",
      "src/core/parsers/base-parser.ts",
      "src/core/parsers/claude/parser.ts",
    ],
    rules: { "no-console": ["error", { allow: ["warn", "error"] }] },
  },
  {
    // The log prefix comes from EXTENSION_NAME, as in service-worker.ts: a
    // rebrand that edits the constant must not split console output across two
    // product names. (Replaces tests/unit/extension/content/content-script-log-prefix.)
    files: ["src/extension/content/content-script.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\[AI Chat Exporter\\]/]",
          message: "Use `[${EXTENSION_NAME}]` from shared/constants, not a hardcoded prefix.",
        },
        {
          selector: "TemplateElement[value.raw=/\\[AI Chat Exporter\\]/]",
          message: "Use `[${EXTENSION_NAME}]` from shared/constants, not a hardcoded prefix.",
        },
      ],
    },
  },
  {
    // Build-time Node scripts (scripts/selector-probe.mjs) are not part of any
    // tsconfig, so type-aware linting cannot parse them -- `project: true`
    // fails outright with "file was not found in any of the provided
    // project(s)". They are still worth linting, just untyped: turn the
    // type-checked layer off for them rather than skipping the files.
    files: ["scripts/**/*.mjs", "scripts/**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { project: false, projectService: false },
      globals: { console: "readonly", process: "readonly", Buffer: "readonly", URL: "readonly" },
    },
  },
  {
    ignores: ["dist/**", "dist-probe/**", "tmp/**", "node_modules/**", "*.js", "*.cjs"],
  }
);
