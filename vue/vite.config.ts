import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import * as path from "path"
import typescript2 from "rollup-plugin-typescript2"
import dts from "vite-plugin-dts"

import type { Plugin } from "vite"

// https://github.com/protobufjs/protobuf.js/issues/1754
function protobufPatch(): Plugin {
    return {
        name: "protobuf-patch",
        transform(code, id) {
            if (id.endsWith("@protobufjs/inquire/index.js")) {
                return {
                    code: code.replace(`eval("quire".replace(/^/,"re"))`, "require"),
                    map: null,
                }
            }
        },
    }
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        protobufPatch(),
        vue(),
        dts({
            insertTypesEntry: true,
        }),
        typescript2({
            check: false,
            include: ["src/components/**/*.vue", "src/**/*.ts"],
            tsconfigOverride: {
                compilerOptions: {
                    outDir: "dist",
                    sourceMap: true,
                    declaration: true,
                    declarationMap: true,
                },
            },
            exclude: ["vite.config.ts"],
        }),
    ],
    build: {
        cssCodeSplit: true,
        lib: {
            // Could also be a dictionary or array of multiple entry points
            entry: "src/index.ts",
            name: "inhumate-rti-vue",
            formats: ["es", "cjs", "umd"],
            fileName: (format) => `inhumate-rti-vue.${format}.js`,
        },
        rollupOptions: {
            // make sure to externalize deps that should not be bundled
            // into your library
            input: {
                main: path.resolve(__dirname, "src/index.ts"),
            },
            external: ["vue", "pinia"],
            output: {
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "main.css") return "components.css"
                    return assetInfo.name
                },
                exports: "named",
                globals: {
                    vue: "Vue",
                    pinia: "pinia",
                },
            },
            onwarn: (warning, defaultHandler) => {
                if (warning.code !== "FILE_NAME_CONFLICT") {
                    defaultHandler(warning)
                }
            },
        },
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
})
