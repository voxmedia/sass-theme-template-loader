var path = require('path');
var async = require('async');
var sass = require('node-sass');
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
  var deps = [];
  var callback = this.async();
  var isSync = typeof callback !== 'function';
  var resource = plugin.parseResource(this.resourcePath, content);
  var opts = plugin.renderer.merge({}, plugin.renderer.sassOptions || {}, {
    file: resource.file,
    data: resource.contents
  });

  function addDependency(filepath) {
    if (path.isAbsolute(filepath)) {
      filepath = path.normalize(filepath);
      self.dependency(filepath);
      deps.push(filepath);
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

  // Webpack setting for optimized output:
  if (this.minimize) opts.outputStyle = 'compressed';

  // Render Sync:
  if (isSync) {
    try {
      var result = sass.renderSync(opts);
      plugin.reportFieldUsage(this.resourcePath, deps);
      return result.css.toString();
    } catch (err) {
      throw plugin.formatError(err, opts.file);
    }
  }

  // Render Async:
  asyncSassJobQueue.push(opts, function(err, result) {
    if (err) return callback(plugin.formatError(err, opts.file));
    plugin.reportFieldUsage(self.resourcePath, deps);
    callback(null, result.css.toString(), null);
  });
};
