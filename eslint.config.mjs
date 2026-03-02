import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import sonarjs from "eslint-plugin-sonarjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: {
      sonarjs,
    },
    rules: {
      // Keep only narrowly-scoped local overrides here.
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "docs/reports/**",
      "testsuite/reports/**",
      "next-env.d.ts",
      "public/sw.js",
      "public/sw-custom.js",
      "public/workbox-*.js",
    ],
  },
];

export default eslintConfig;
