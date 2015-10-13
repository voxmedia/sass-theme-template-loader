var path = require('path');
var sass = require('node-sass');
var async = require('async');
var SassThemeTemplatePlugin = require('./index');

// This queue makes sure node-sass leaves one thread available for executing
// fs tasks when running the custom importer code.
// This can be removed as soon as node-sass implements a fix for this.
var threadPoolSize = process.env.UV_THREADPOOL_SIZE || 4;
var asyncSassJobQueue = async.queue(sass.render, threadPoolSize - 1);

/**
 * The Sass theme template loader validates theme variable usage and renders Sass.
 * @param {String} content of loaded file source.
 * @returns {String} rendered CSS string with theme variable fields.
 */
module.exports = function(content) {
  var plugin = SassThemeTemplatePlugin.plugin;

  if (!plugin) {
    throw new Error("sass-theme-template-loader must be used with SassThemeTemplatePlugin.");
  }

  this.cacheable();

  var self = this;
  var callback = this.async();
  var isSync = typeof callback !== 'function';
  var resource = plugin.parseResource(this.resourcePath, content);
  var opts = {
    file: resource.file,
    data: resource.contents,
    outputStyle: this.minimize ? 'compressed' : plugin.renderer.outputStyle
  };

  // opts.sourceMap
  // Not using the `this.sourceMap` flag because css source maps are different
  // @see https://github.com/webpack/css-loader/pull/40
  if (opts.sourceMap) {
    // deliberately overriding the sourceMap optsion
    // this value is (currently) ignored by libsass when using the data input instead of file input
    // however, it is still necessary for correct relative paths in result.map.sources
    opts.sourceMap = this.options.output.path + '/sass.map';
    opts.omitSourceMapUrl = true;

    // If sourceMapContents option is not set, set it to true otherwise maps will be empty/null
    // when exported by webpack-extract-text-plugin.
    if (!opts.hasOwnProperty('sourceMapContents')) {
      opts.sourceMapContents = true;
    }
  }

  function addDependency(filepath) {
    if (path.isAbsolute(filepath)) {
      self.dependency(path.normalize(filepath));
    }
  }

  function importerContext(filepath) {
    return filepath === 'stdin' ? path.dirname(opts.file) : filepath;
  }

  function importerSync(url, fileContext) {
    var res = plugin.resolveSync(url, importerContext(fileContext));
    addDependency(res.file);
    return res;
  }

  function importerAsync(url, fileContext, done) {
    plugin.resolve(url, importerContext(fileContext), function(err, res) {
      if (err) return done(err);
      addDependency(res.file);
      done(res);
    });
  }

  opts.importer = isSync ? importerSync : importerAsync;

  // Render Sync:
  if (isSync) {
    try {
      var result = sass.renderSync(opts);
      return result.css.toString();
    } catch (err) {
      throw plugin.formatError(err, opts.file);
    }
  }

  // Render Async:
  asyncSassJobQueue.push(opts, function(err, result) {
    if (err) {
      return callback(plugin.formatError(err, opts.file));
    }

    if (result.map && result.map !== '{}') {
      result.map = JSON.parse(result.map);
      result.map.file = opts.file;
      result.map.sources[0] = path.relative(self.options.output.path, opts.file);
    } else {
      result.map = null;
    }

    callback(null, result.css.toString(), result.map);
  });
};
