var fs = require('fs');
var path = require('path');
var Thematic = require('sass-thematic/lib/thematic');

/**
* Theme Template Plugin for Webpack
* Hooks template file output into the loader pipe.
* This plugin must be used as part of the template loader pipe.
*/
function ThemeTemplatePlugin(opts) {
  if (ThemeTemplatePlugin.plugin)
    throw 'ThemeTemplatePlugin was already instantiated.';

  ThemeTemplatePlugin.plugin = this;
  opts = opts || {};

  this.cwd = opts.cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  this.writePath = opts.writePath ? path.resolve(opts.cwd, opts.writePath) : null;
  this.filename = opts.filename || '[name].css';
  this.includeExts = opts.includeExts || ['.scss', '.sass'];
  this.includePaths = (opts.includePaths || []).map(function(includePath) {
    return path.resolve(this.cwd, includePath);
  }, this);

  this.renderer = new Thematic({}, opts);
  this.templateCache = {};
  this.importCache = {};
  this.warnings = [];
}

/**
* Applies the plugin to the Webpack compiler.
*/
ThemeTemplatePlugin.prototype.apply = function(compiler) {
  var self = this;
  var cssFile = /(.+)\.css$/;

  compiler.plugin('emit', function(compilation, callback) {

    function renderAsset(filename) {
      var asset = compilation.assets[filename];
      var source = asset.source();

      if (self.writePath) {
        var cssmin = require('cssmin');
        var templateSource = self.renderer.fieldLiteralsToInterpolations(source);
        var templateName = self.filename.replace('[name]', filename.match(cssFile)[1]);
        var templatePath = path.resolve(self.writePath, templateName);

        try {
          fs.writeFileSync(templatePath, templateSource);
        } catch(err) {
          self.addWarning(err, templatePath, 'template could not be written');
        }
      }

      source = self.renderer.fieldLiteralsToValues(source);

      asset.source = function() {
        return source;
      };
      asset.size = function() {
        return source.length;
      };
    }

    // Render all CSS assets:
    for (var filename in compilation.assets) {
      if (cssFile.test(filename)) {
        renderAsset(filename);
      }
    }

    // Report all warnings:
    this.warnings.forEach(function(warning) {
      compilation.warnings.push(warning);
    });

    // Reset plugin state:
    this.warnings = [];
    callback();
  });
};

/**
* Assembles a list of lookup paths for the import engine to resolve.
* @param {String} uri of the file import to resolve.
* @param {String} context uri of the previously imported file.
* @returns {Array} array of lookup paths.
*/
ThemeTemplatePlugin.prototype.lookupPaths = function(uri, prevUri) {
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
ThemeTemplatePlugin.prototype.resolve = function(uri, prevUri, done) {
  var self = this;
  var paths = this.lookupPaths(uri, prevUri);

  function lookup(index) {
    var filepath = paths[index];

    if (!filepath) return setImmediate(function() {
      done(self.pathLookupError(paths, uri, prevUri));
    });

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
ThemeTemplatePlugin.prototype.resolveSync = function(uri, prevUri) {
  var paths = this.lookupPaths(uri, prevUri);
  var result = {};

  for (var i=0; i < paths.length; i++) {
    var filepath = paths[i];

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
ThemeTemplatePlugin.prototype.parseResource = function(filepath, data) {
  var resource = {file: filepath};

  try {
    resource.contents = this.renderer.loadSource(data)
      .parse({template: true, disableTreeRemoval: true})
      .toString();
  } catch (err) {
    resource.contents = this.renderer.varsToFieldLiterals(data);
    this.addWarning(err, filepath, 'failed to parse syntax tree, using regex fallback.');
  }

  return resource;
};

/**
* Formats a path lookup error.
*/
ThemeTemplatePlugin.prototype.pathLookupError = function(paths, uri, prevUri) {
  return new Error('Import error in:\n'+ prevUri +'\nThe import "'+ uri +'" could not be resolved. Searched paths:\n'
    + paths.map(function(p) { return ' - ' + p }).join('\n'));
};

/**
* Formats a general error.
*/
ThemeTemplatePlugin.prototype.formatError = function(err, fileContext, message) {
  if (!err.file || err.file === 'stdin') {
    err.file = fileContext;
  }

  if (/\.s?css/.test(err.file)) {
    var os = require('os');
    var excerpt = null;

    try {
      excerpt = fs.readFileSync(err.file, 'utf8');
      excerpt = os.EOL + excerpt.split(os.EOL)[err.line-1] +
                os.EOL + new Array(err.column-1).join(' ') + '^';
    } catch (err) {
      excerpt = null;
    }
  }

  var errorMessage = ['ThemeTemplatePlugin'];
  errorMessage.push('-> '+ (message || 'Error encountered in') +': '+ fileContext);
  if (err.message) errorMessage.push('-> '+ err.message);
  if (excerpt)  errorMessage.push(excerpt);

  // Throw new error:
  var error = new Error(errorMessage.join('\n'));
  error.line = err.line || null;
  error.column = err.column || null;
  error.hideStack = true;
  return error;
};

/**
* Formats a path lookup error.
*/
ThemeTemplatePlugin.prototype.addWarning = function(err, fileContext, message) {
  this.warnings.push(err.message);
};

module.exports = ThemeTemplatePlugin;
