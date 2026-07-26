// Shim Jest pour node-gyp-build.
// @signalapp/libsignal-client localise son binaire natif via
// `import.meta.dirname`, que la transformation Babel de Jest remplace
// par `undefined`. On rattrape ce cas en pointant vers le repertoire
// du paquet ; tout autre appelant garde le comportement normal.
const path = require('path');
const load = require('node-gyp-build/node-gyp-build.js');

module.exports = function loadShim(dir) {
  if (typeof dir !== 'string' || dir.startsWith('undefined')) {
    dir = path.join(__dirname, '..', 'node_modules', '@signalapp', 'libsignal-client');
  }
  return load(dir);
};
