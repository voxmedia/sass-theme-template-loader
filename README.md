# Sass theme template loader for Webpack

When creating themed websites, a common strategy is to generate pre-rendered CSS templates with theme values interpolated into them. This Webpack loader provides a system for passing raw Sass variable fields through to a rendered CSS template using the [SassThematic](https://github.com/gmac/sass-thematic) workflow.

This loader expects that you're already using the `extract-text-webpack-plugin` to pull your CSS assets out into separate files. This loader will render Sass markup with embedded template fields, and then generate a template version of all extracted CSS assets.

## Example

**In `_theme.scss`:**
_This file identifies the names of relevant theme variables._

```scss
$color-theme: green;
```

**In `_vars.scss`:**

```scss
$color-other: red;
```

**In `main.scss`:**

```scss
@import 'theme';
@import 'vars';

.themed {
  color: $color-theme;
}

.unthemed {
  color: $color-other;
}
```

**Rendered `main.css`:**

```css
.themed { color: <%= @theme[:color_theme] %>; }
.unthemed { color: red; }
```

## Install

Include `extract-text-webpack-plugin` and `sass-theme-template-loader` in your package:

```
npm install --save extract-text-webpack-plugin
npm install --save sass-theme-template-loader
```

## Configure

The `sass-theme-template` loader handles primary Sass rendering. Use this loader _instead of_ other Sass loaders.

```javascript
var ExtractText = require('extract-text-webpack-plugin');
var SassThemeTemplate = require('sass-theme-template-loader');

var config = {
  entry: {
    'main': 'main.js',
    'other': 'other.js'
  },
  output: {
    path: '/path/to/output'
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
      output: true,
      templateOpen: '<%= @theme[:',
      templateClose: '] %>',
      templateSnakeCase: true
    })
  ]
};
```

**Setup:**

The `SassThemeTemplate` plugin piggy-backs off of the `ExtractText` plugin. Like `extract-text-webpack-plugin`, this build tool also uses a loader and a plugin in tandem.

1. Install the `sass-theme-template` loader as the first (right-most) Sass loader. This should _replace_ all other Sass loaders.
1. Install the `SassThemeTemplate` after the `ExtractText` plugin. Configuration options are the same as [SassThematic](https://github.com/gmac/sass-thematic).

**How it works:**

The `sass-theme-template` loader will render your Sass markup with theme-specific variable names stubbed out as template fields. In addition, it will validate your usage of Sass theme variables to assure these post-rendered values are not used in pre-rendered contexts. The following pre-rendered implementations are not allowed:

- Theme variables as arguments are NOT allowed: `color: tint($theme-fail, 10%);`
- Theme variables in operations are NOT allowed: `top: $theme-fail + 5;`
- Theme variables in interpolations are NOT allowed: `margin: #{$theme-fail}px;`

After Sass has been rendered with template fields passed through, you're welcome to pass your CSS along to any number of susequent CSS loaders (ie: autoprefixer, etc). `ExtractText` should be configured to pull your final CSS assets out of your JavaScript build.

Finally, the `SassThemeTemplate` plugin finds all extracted CSS assets, and does a final pass to fill in theme values for the extracted assets, and creates an alternate version of each asset with template interpolations.
