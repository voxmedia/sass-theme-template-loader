var fs = require('fs');
var os = require('os');
var path = require('path');
var mkdirp = require('mkdirp');
var Thematic = require('sass-thematic/lib/thematic');

/**
* Theme Template Plugin for Webpack
* Hooks template file output into the loader pipe.
* This plugin must be used as part of the template loader pipe.
*/
function SassThemeTemplatePlugin(opts) {
  if (SassThemeTemplatePlugin.plugin)
    throw 'SassThemeTemplatePlugin was already instantiated.';

  SassThemeTemplatePlugin.plugin = this;
  opts = opts || {};

  this.cwd = opts.cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  this.filename = opts.filename || '[name].css';
  this.includeExts = opts.includeExts || ['.scss', '.sass'];
  this.includePaths = (opts.includePaths || []).map(function(includePath) {
    return path.resolve(this.cwd, includePath);
  }, this);

  this.renderer = new Thematic({}, opts);
  this.resourceCache = {};
  this.errors = [];
  this.warnings = [];
  this.options = opts;
  this.dirty = true;
}

/**
* Applies the plugin to the Webpack compiler.
*/
SassThemeTemplatePlugin.prototype.apply = function(compiler) {
  var self = this;
  var cssFile = /([^\.]+).*\.css$/;

  // Pre-build step used to invalidate caches:
  compiler.plugin('compilation', function(compilation) {
    var changed = compilation.fileTimestamps;

    // Invalidate cached files:
    for (var filename in changed) {
      var cached = self.resourceCache[filename];
      if (cached && cached.timestamp < changed[filename]) {
        delete self.resourceCache[filename];
        self.dirty = true;
      }
    }
  });

  // Pre-emit step used for a final pass on all published assets:
  compiler.plugin('emit', function(compilation, callback) {
    if (!self.dirty) return callback();

    var pendingTasks = 1;
    var completedTasks = 0;
    var done = function() {
      completedTasks++;
      if (pendingTasks === completedTasks) {
        // Report all warnings and reset plugin state:
        compilation.errors.concat(self.errors);
        compilation.warnings.concat(self.warnings);
        self.errors = [];
        self.warnings = [];
        self.dirty = false;
        callback();
      }
    };

    /**
    * Renders a CSS asset within the Webpack compilation.
    * The CSS will be populated with values,
    * and an alternate template version will be created.
    */
    function renderAsset(filename) {
      var asset = compilation.assets[filename];
      var source = asset.source();
      var templateSource = self.renderer.fieldLiteralsToInterpolations(source);
      var templateName = self.filename.replace('[name]', filename.match(cssFile)[1]);

      // Add header:
      if (self.options.fileHeader)
        templateSource = self.options.fileHeader +'\n'+ templateSource;

      // Add footer, replacing any sourcemap reference:
      // (loader currently has no sourcemap support)
      if (self.options.fileFooter)
        templateSource = templateSource.replace(/\n*(\/\*[^\*]+\*\/)?$/, '\n'+ self.options.fileFooter);

      // Add processed template asset to the build:
      compilation.assets[templateName] = {
        source: function() {
          return templateSource;
        },
        size: function() {
          return templateSource.length;
        }
      };

      // Attempt to output the processed template asset:
      // We're doing this in addition to adding the compiled asset to the build,
      // so that we can access the live rendered template view within an app.
      writeAsset(self.options.output, templateName, templateSource);

      // Process flat CSS asset:
      source = self.renderer.fieldLiteralsToValues(source);

      // Update CSS asset within the build:
      asset.source = function() {
        return source;
      };
      asset.size = function() {
        return source.length;
      };
    }

    /**
    * Writes an asset to an output directory.
    * This is done in addition to adding the asset to the webpack build,
    * so that apps can access the template file as a view.
    */
    function writeAsset(outputPath, filename, source) {
      if (!outputPath) return;

      outputPath = (typeof outputPath === 'string') ? outputPath : compiler.options.output.path;
      var templatePath = path.resolve(outputPath, filename);

      pendingTasks++;
      mkdirp(path.dirname(templatePath), function(err) {
        if (err) {
          self.addError(err, templatePath, 'template output directory could not be created');
          return done();
        }
        fs.writeFile(templatePath, source, function(err) {
          if (err) self.addError(err, templatePath, 'template could not be written');
          return done();
        });
      });
    }

    // Render all CSS assets:
    for (var filename in compilation.assets) {
      if (cssFile.test(filename)) {
        renderAsset(filename);
      }
    }

    done();
  });
};

/**
* Assembles a list of lookup paths for the import engine to resolve.
* @param {String} uri of the file import to resolve.
* @param {String} context uri of the previously imported file.
* @returns {Array} array of lookup paths.
*/
SassThemeTemplatePlugin.prototype.lookupPaths = function(uri, prevUri) {
  var prev = path.parse(prevUri);
  var file = path.parse(uri);
  file.name = file.name.replace(/^_/, '');

  var lookupPaths = (prev.ext ? [prev.dir] : [prevUri, prev.dir]).concat(this.includePaths);
  var lookupExts = file.ext ? [file.ext] : this.includeExts;
  var lookupNames = [];
  var lookups = [];

  lookupExts.forEach(function(ext) {
    // "_file.ext", "file.ext"
    lookupNames.push('_' + file.name + ext, file.name + ext);
  });

  for (var i=0; i < lookupPaths.length; i++) {
    for (var j=0; j < lookupNames.length; j++) {
      lookups.push(path.resolve(lookupPaths[i], file.dir, lookupNames[j]));
    }
  }

  return lookups;
};

/**
* Async file resolver, designed to interface with Sass.
* @param {String} uri of the requested import.
* @param {String} context uri of the previously imported file.
* @param {Function} callback to fire on completion.
* @callback {file: String, error: Error} || {file: String, contents: String}
*/
SassThemeTemplatePlugin.prototype.resolve = function(uri, prevUri, done) {
  var self = this;
  var paths = this.lookupPaths(uri, prevUri);

  function lookup(index) {
    var filepath = paths[index];
    var cached = self.resourceCache[filepath];

    if (cached || !filepath) {
      return setImmediate(function() {
        if (cached) return done(null, cached);
        done(self.pathLookupError(paths, uri, prevUri));
      });
    }

    fs.readFile(filepath, 'utf-8', function(err, data) {
      if (err && err.code === 'ENOENT') return lookup(index+1);
      if (err) return done(err);
      done(null, self.parseResource(filepath, data));
    });
  }

  return lookup(0);
};

/**
* Sync file resolver, designed to interface with Sass.
* @param {String} uri of the requested import.
* @param {String} context uri of the previously imported file.
* @returns {file: String, error: Error} || {file: String, contents: String}
*/
SassThemeTemplatePlugin.prototype.resolveSync = function(uri, prevUri) {
  var paths = this.lookupPaths(uri, prevUri);
  var result = {};

  for (var i=0; i < paths.length; i++) {
    var filepath = paths[i];
    var cached = this.resourceCache[filepath];

    if (cached) return cached;

    try {
      var data = fs.readFileSync(filepath, 'utf-8');
      return this.parseResource(filepath, data);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      else throw err;
    }
  }

  throw this.pathLookupError(paths, uri, prevUri);
};

/**
* Templated resource parser.
* Parses imported file data into a Sass string with template fields.
* Returned resource data may be fed into the Sass importer interface.
* @param {String} filepath of the loaded resource file.
* @param {String} data of the loaded resource file contents.
* @returns {file: String, error: Error} || {file: String, contents: String}
*/
SassThemeTemplatePlugin.prototype.parseResource = function(filepath, data) {
  var resource = {file: filepath};

  try {
    resource.contents = this.renderer.loadSource(data)
      .parse({template: true, disableTreeRemoval: true})
      .toString();
  } catch (err) {
    resource.contents = this.renderer.varsToFieldLiterals(data);
    this.addWarning(err, filepath, 'Failed to parse syntax tree, using regex fallback');
  }

  resource.timestamp = Date.now();
  this.resourceCache[filepath] = resource;
  return resource;
};

/**
* Formats a path lookup error.
*/
SassThemeTemplatePlugin.prototype.pathLookupError = function(paths, uri, prevUri) {
  return new Error('Import error in:\n'+ prevUri +'\nThe import "'+ uri +'" could not be resolved. Searched paths:\n'
    + paths.map(function(p) { return ' - ' + p }).join('\n'));
};

/**
* Formats a general error.
*/
SassThemeTemplatePlugin.prototype.formatError = function(err, fileContext, message) {
  if (!err.file || err.file === 'stdin') {
    err.file = fileContext;
  }

  var excerpt = null;
  if (/\.s?css/.test(err.file)) {
    try {
      excerpt = fs.readFileSync(err.file, 'utf8');
      excerpt = os.EOL + excerpt.split(os.EOL)[err.line-1] +
                os.EOL + new Array(err.column-1).join(' ') + '^';
    } catch (err) {
      excerpt = null;
    }
  }

  var errorMessage = ['Sass Theme Template'];
  errorMessage.push('-> '+ (message || 'Error encountered in') +':\n'+ fileContext);
  if (err.message) errorMessage.push('-> '+ err.message);
  if (excerpt)  errorMessage.push(excerpt);

  // Throw new error:
  var error = new Error(errorMessage.join(os.EOL));
  error.line = err.line || null;
  error.column = err.column || null;
  error.hideStack = true;
  return error;
};

/**
* Adds a critical error message.
*/
SassThemeTemplatePlugin.prototype.addError = function(err, fileContext, message) {
  this.errors.push(this.formatError(err, fileContext, message));
};

/**
* Adds a non-critical warning message.
*/
SassThemeTemplatePlugin.prototype.addWarning = function(err, fileContext, message) {
  var warningMessage = ['Sass Theme Template'];
  var preview = null;

  if (typeof err.css_ === 'string' && err.line) {
    preview = '>>>>> '+ err.css_.split(os.EOL)[err.line-1];
  }

  warningMessage.push('-> '+ (message || 'Problem encountered in') +' in:\n'+ fileContext);
  warningMessage.push('-> '+ err.message);
  if (preview) warningMessage.push(preview);

  this.warnings.push(warningMessage.join(os.EOL));
};

module.exports = SassThemeTemplatePlugin;
