var path = require('path');
var sass = require('node-sass');
var async = require('async');
var ThemeTemplatePlugin = require('./index');

// This queue makes sure node-sass leaves one thread available for executing
// fs tasks when running the custom importer code.
// This can be removed as soon as node-sass implements a fix for this.
var threadPoolSize = process.env.UV_THREADPOOL_SIZE || 4;
var asyncSassJobQueue = async.queue(sass.render, threadPoolSize - 1);

/**
 * The sass-loader makes node-sass available to webpack modules.
 *
 * @param {string} content
 * @returns {string}
 */
module.exports = function(content, plugin) {
  var plugin = ThemeTemplatePlugin.plugin;

  if (!plugin) {
    throw new Error("Theme template loaders must be used with ThemeTemplatePlugin.");
  }

  this.cacheable();
  var callback = this.async();
  var isSync = typeof callback !== 'function';
  var resource = plugin.parseResource(this.resourcePath, content);
  
  // Validate the integrity of the loaded resource:
  // report any errors with the resource before proceeding.
  if (resource.error) {
    if (isSync) throw resource.error;
    return callback(resource.error);
  }

  var self = this;
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
    self.dependency(path.normalize(filepath));
  }

  opts.importer = function(url, fileContext, done) {
    // Convert "stdin" reference to a real file path:
    if (fileContext === 'stdin') {
      fileContext = path.dirname(opts.file);
    }

    if (isSync) {
      var res = plugin.resolveSync(url, fileContext);
      addDependency(res.file);
      return res.error ? res.error : res;
    }

    plugin.resolve(url, fileContext, function(err, res) {
      if (err) return done(err);
      addDependency(res.file);
      done(res.error ? res.error : res);
    });
  };

  // Render Sync:
  if (isSync) {
    try {
      var result = sass.renderSync(opts);
      result.stats.includedFiles.map(addDependency);
      return result.css.toString();
    } catch (err) {
      err.file && addDependency(err.file);
      throw plugin.formatError(err, opts.file);
    }
  }

  // Render Async:
  asyncSassJobQueue.push(opts, function(err, result) {
    if (err) {
      err.file && addDependency(err.file);
      return callback(plugin.formatError(err, opts.file));
    }

    if (result.map && result.map !== '{}') {
      result.map = JSON.parse(result.map);
      result.map.file = opts.file;
      result.map.sources[0] = path.relative(self.options.output.path, opts.file);
    } else {
      result.map = null;
    }

    result.stats.includedFiles.map(addDependency);
    callback(null, result.css.toString(), result.map);
  });
};