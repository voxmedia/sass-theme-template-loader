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
    if (err) return callback(plugin.formatError(err, opts.file));
    callback(null, result.css.toString(), null);
  });
};
