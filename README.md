# Sass theme template generator for Webpack

When creating themed CSS to share across numerous sites, a common strategy is to pass site-specific theme variables through to a pre-rendered CSS template. This Webpack loader provides a system for passing raw Sass variable fields through to a rendered CSS template using [SassThematic](https://github.com/gmac/sass-thematic) as a foundation.

This loader expects that you're already using the `extract-text-webpack-plugin` to pull your CSS out into separate files. This loader handles rendering Sass with embedded template fields, and then populating and writing final stylesheet and template versions of your CSS.

## Example

**In `_theme.scss`:** `$color-theme: green;`
**In `_vars.scss`:** `@import 'theme'; $color-other: red;`
**In `main.scss`:**

```
@import 'vars';

.themed {
  color: $color-theme;
}

.unthemed {
  color: $color-other;
}
```

**Rendered `main.css`:**

```
.themed { color: <%= color-theme %>; }
.unthemed { color: red; }
```

## Install

Include `extract-text-webpack-plugin` and `sass-theme-template-loader` in your package:

```
npm install --save extract-text-webpack-plugin
npm install --save sass-theme-template-loader
```

## Configure

```javascript
var ExtractText = require('extract-text-webpack-plugin');
var SassThemeTemplate = require('sass-theme-template-loader');

var config = {
  entry: {
    'main': 'main.js',
    'other': 'other.js'
  },
  module: {
    loaders: [
      { test: /\.scss$/, loader: ExtractText.extract('style', 'css!sass-theme-template') },
    ]
  },
  plugins: [
    new ExtractText('[name].css'),
    new SassThemeTemplate({
      cwd: __dirname,
      includePaths: ['./shared/'],
      varsFile: './_vars.scss',
      filename: '[name].css.erb',
      writePath: 'public/',
      templateOpen: '<%= @theme[:',
      templateClose: '] %>',
      templateSnakeCase: true
    })
  ]
};
```

**How it works:**

SassThemeTemplate piggy-backs off of the ExtractText plugin for Webpack. First, the `sass-theme-template` loader is installed in the Sass loader list (_replacing_ other Sass loaders). The `sass-theme-template` loader will handle rendering your Sass with theme-specific variable names stubbed out as template fields. Note that template fields may _not_ be used in pre-rendered Sass transformations (ie: math expressions, interpolations, etc), so the loader also validates your useage of Sass theme variables to discover pre-render implementations of post-render data fields.

After Sass has been rendered by the loader with template fields passed through, you're welcome to pass your CSS along to any number of susequent CSS loaders (ie: autoprefixer, etc). ExtractText should be configured to pull your final CSS files out of your JavaScript build.

Finally, the `SassThemeTemplate` plugin finds all extracted CSS assets, and does a final pass at rendering theme variable values into the extracted CSS assets, and creates an alternate version of the asset with template interpolations.
