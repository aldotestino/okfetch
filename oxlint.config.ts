import { defineConfig } from "oxlint";

export default defineConfig({
  // apps/** is also passed as --ignore-pattern in the lint scripts: apps/docs
  // has its own .oxlintrc.json, and a nested config makes oxlint lint that
  // directory regardless of what this list says.
  ignorePatterns: [".agents/**", "apps/**"],
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "promise",
    "jest",
  ],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    "max-classes-per-file": "off",
    "ban-types": "off",
    "no-empty-object-type": "off",
    "max-statements": ["warn", 30],
    "promise/avoid-new": "off",
    "no-promise-executor-return": "off",
    "func-names": "off",
    complexity: ["warn", 30],
    "require-await": "off",
    "sort-keys": "off",
    "import/no-cycle": "off",
    "no-inline-comments": "off",
    "consistent-type-definitions": ["error", "type"],
  },
});
