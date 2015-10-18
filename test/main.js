var assert = require('assert');
var webpack = require('webpack');
var config = require('./config');

describe('tests', function() {

  before(function(done) {
    //console.log(config('./style/main.scss'));
    webpack(config('./style/a.css'), done)
  })

  it ('is tested', function() {
    assert(true, true)
  })
})