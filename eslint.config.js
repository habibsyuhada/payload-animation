import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      boundaries,
    },
    settings: {
      "import/resolver": {
        node: { extensions: [".js", ".ts"] },
      },
      "boundaries/elements": [
        { type: "sim", pattern: "packages/sim/{src,dist}/**" },
        { type: "replay", pattern: "packages/replay/{src,dist}/**" },
        { type: "shared", pattern: "packages/shared/{src,dist}/**" },
        { type: "ui", pattern: "packages/ui/{src,dist}/**" },
        { type: "app", pattern: "apps/*/{src,dist}/**" },
        { type: "tool", pattern: "tools/*/{src,dist}/**" },
      ],
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "sim", allow: [] },
            { from: "replay", allow: ["sim"] },
            { from: "shared", allow: [] },
            { from: "ui", allow: ["shared"] },
            { from: "app", allow: ["sim", "replay", "shared", "ui"] },
            { from: "tool", allow: ["sim", "replay", "shared"] },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "Math.random() dilarang di packages/sim — pakai rng.ts (PRNG seeded) untuk determinisme.",
        },
      ],
    },
  },
  {
    files: ["packages/sim/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Date dilarang di packages/sim — merusak determinisme." },
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"],
  },
];
