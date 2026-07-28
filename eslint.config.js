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
      "@typescript-eslint/no-non-null-assertion": "warn",
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
    ignores: ["dist/**", "tmp/**", "node_modules/**", "*.js", "*.cjs"],
  }
);
