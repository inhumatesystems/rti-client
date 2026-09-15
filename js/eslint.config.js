import js from "@eslint/js"
import tseslint from "typescript-eslint"
import globals from "globals"
import skipFormatting from "eslint-config-prettier/flat"

// Deliberately lenient: catch real mistakes, not style. Formatting is prettier's job.
export default tseslint.config(
    { ignores: ["lib/**", "dist/**", "coverage/**", "src/generated/**", "test/**"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ["**/*.{ts,js,cjs}"],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            // `Function` is part of the public callback signatures
            "@typescript-eslint/no-unsafe-function-type": "off",
            "no-var": "warn",
            "prefer-const": "warn",
            "no-useless-assignment": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
        },
    },
    {
        files: ["**/*.cjs"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
    skipFormatting,
)
