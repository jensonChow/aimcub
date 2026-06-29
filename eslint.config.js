// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Forbidden in the shared kernel (@core/domain, @core/types): any platform / IO
 * dependency. The kernel must stay pure TS so all four channels can import it.
 * This is the CI guard that keeps "shared core" from rotting into a slogan.
 */
const KERNEL_FORBIDDEN = [
  { name: "react", message: "core kernel must stay platform-free" },
  { name: "react-dom", message: "core kernel must stay platform-free" },
  { name: "react-native", message: "core kernel must stay platform-free" },
  { name: "next", message: "core kernel must stay platform-free" },
  {
    name: "fs",
    message: "core kernel must not touch the filesystem / node builtins",
  },
];

const KERNEL_FORBIDDEN_PATTERNS = [
  { group: ["@supabase/*"], message: "core kernel must not depend on Supabase; do IO in app shells / edge functions" },
  { group: ["node:*"], message: "core kernel must not import node builtins" },
  { group: ["expo", "expo/*", "expo-*"], message: "core kernel must stay platform-free" },
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/out/**", "**/node_modules/**", "**/.turbo/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The purity guard — scoped to the shared kernel only.
    files: ["packages/core/**/*.ts", "packages/types/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: KERNEL_FORBIDDEN, patterns: KERNEL_FORBIDDEN_PATTERNS },
      ],
    },
  },
  {
    // Tests may be looser.
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
