// Plugin Babel minimal pour le projet Jest "node" : remplace
// `import.meta` par `({})` afin que le CJS transforme compile.
// Consequence : import.meta.dirname devient undefined, cas rattrape
// par jest/node-gyp-build.js pour @signalapp/libsignal-client.
module.exports = function importMetaShim() {
  return {
    visitor: {
      MetaProperty(path) {
        path.replaceWithSourceString('({})');
      },
    },
  };
};
