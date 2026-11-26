import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Minimal, standard Next.js + TypeScript ruleset (no custom stricter rules) —
// this is a first-time reopen on a codebase that has never been linted, so we
// start from the recommended baseline rather than importing a large backlog
// of style debates. Tighten later if wanted.
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "prisma/migrations/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
