var path = require('path');
var ExtractText = require('extract-text-webpack-plugin');
var SassThemeTemplate = require('../index');

module.exports = function(entryFile) {
  return {
    entry: {
      'test': path.resolve(__dirname, entryFile)
    },
    output: {
      path: path.resolve(__dirname, './result'),
      filename: '[name].js'
    },
    module: {
      loaders: [
        { test: /\.css$/, loader: ExtractText.extract('style', 'css') }
      ]
    },
    resolve: {
      extensions: ['.scss']
    },
    resolveLoader: {
      modulesDirectories: ['node_modules', path.resolve(__dirname, './node_loaders')],
      extensions: ['', '.js']
    },
    plugins: [
      new ExtractText('[name].css'),
      new SassThemeTemplate({
        cwd: __dirname,
        includePaths: ['./stylelib/'],
        output: false,
        varsFile: path.resolve(__dirname, './stylelib/_theme.scss'),
        filename: '[name].css.erb',
        templateOpen: '<%= ',
        templateClose: ' %>',
        templateSnakeCase: true,
        fileHeader: '<%= header %>',
        fileFooter: '<%= footer %>'
      })
    ]
  };
};