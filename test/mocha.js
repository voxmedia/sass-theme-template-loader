var assert = require('assert');
var Mocha = require('mocha');
var mocha = new Mocha();

mocha.reporter('dot');
mocha.addFile('test/main');

mocha.run(function(failures) {
  process.on('exit', function() {
    process.exit(failures);
  });
});