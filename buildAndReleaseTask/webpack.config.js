const path = require("path");

module.exports = {
  entry: "./src/index.ts",
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "dist"),
  },

  target: 'node',
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.node$/,
        loader: "node-loader",
      },
    ],
  },
  externals: {
    nodegit: 'commonjs nodegit'
  },
  resolve: {
    extensions: [".ts", ".js"]
  }
};
