const path = require("path")

module.exports = {
    entry: "./lib/index.js",
    devtool: "source-map",
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
    },
    output: {
        filename: "inhumate-rti-bundle-0.0.1-dev-version.js",
        path: path.resolve(__dirname, "dist"),
        library: "RTI",
    },
    performance: {
        hints: false,
        maxEntrypointSize: 512000,
        maxAssetSize: 512000,
    },
}
