import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "promise",
    "jest",
  ],
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
