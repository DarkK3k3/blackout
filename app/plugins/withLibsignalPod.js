// Plugin de config Expo : injecte le pod LibSignalClient dans le
// Podfile genere par prebuild. Necessaire car le pod officiel de
// Signal n'est pas publie sur le CDN CocoaPods — il se consomme
// depuis le depot git, epingle sur un tag precis.
//
// La version DOIT rester alignee avec org.signal:libsignal-android
// (module Android) et @signalapp/libsignal-client (tests Jest).
// Voir docs/DECISIONS.md.

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const LIBSIGNAL_TAG = 'v0.99.1';
const POD_LINE = `  pod 'LibSignalClient', git: 'https://github.com/signalapp/libsignal.git', tag: '${LIBSIGNAL_TAG}'`;

module.exports = function withLibsignalPod(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes("pod 'LibSignalClient'")) {
        // Insere la ligne juste apres l'ouverture du target principal
        contents = contents.replace(/^(target ['"][^'"]+['"] do)$/m, `$1\n${POD_LINE}`);
        if (!contents.includes("pod 'LibSignalClient'")) {
          throw new Error('withLibsignalPod : target introuvable dans le Podfile');
        }
        fs.writeFileSync(podfilePath, contents);
      }
      return config;
    },
  ]);
};
