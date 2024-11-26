const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'srdf.js',
    library: {
      name: "srdf",
      type: "umd"
    },
  },
  resolve: { fallback: { "url": false }},
  /*externals: {
    rdflib: {
      commonjs: 'rdflib',
      commonjs2: 'rdflib',
      amd: 'rdflib',
      root: '_',
    },
  },*/
  mode: "development",
  devtool: "source-map",
};
