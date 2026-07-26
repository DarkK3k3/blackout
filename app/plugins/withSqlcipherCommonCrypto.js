// Plugin de config Expo : faire utiliser a SQLCipher le moteur de
// chiffrement d'Apple (CommonCrypto) plutot qu'OpenSSL.
//
// POURQUOI
// --------
// libsignal embarque BoringSSL, op-sqlite embarque OpenSSL pour
// SQLCipher. Les deux sont compilees DANS LE MEME binaire et exportent
// les memes noms de fonctions (PKCS5_PBKDF2_HMAC, HMAC_Init_ex,
// EVP_sha512...) avec des structures internes differentes. L'editeur de
// liens en choisissait une seule : SQLCipher appelait l'implementation
// BoringSSL en lui passant des structures OpenSSL, et l'app plantait
// dans sha512_block_data_order (crashs iOS du 2026-07-26).
//
// Masquer les symboles de libsignal (-load_hidden) ne suffit PAS : ca
// empeche de les EXPORTER, pas de les utiliser a l'interieur du meme
// binaire. Il faut donc supprimer la seconde implementation, pas la
// cacher.
//
// L'amalgame SQLCipher embarque plusieurs fournisseurs de chiffrement
// selectionnables a la compilation. `SQLCIPHER_CRYPTO_CC` bascule sur
// CommonCrypto, la bibliotheque d'Apple : AES-256 et PBKDF2 fournis par
// le systeme, aucun symbole partage avec BoringSSL.
//
// La base reste chiffree exactement de la meme facon (AES-256) — seul
// le moteur qui execute le calcul change.

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARQUEUR = 'SQLCIPHER_CRYPTO_CC';

const BLOC = `
    # --- Blackout : SQLCipher utilise CommonCrypto, pas OpenSSL ---
    # Evite la collision de symboles avec BoringSSL (embarque par
    # libsignal). Voir plugins/withSqlcipherCommonCrypto.js.
    installer.pods_project.targets.each do |blackout_target|
      if blackout_target.name == 'op-sqlite'
        blackout_target.build_configurations.each do |blackout_config|
          blackout_defs = blackout_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
          blackout_defs = [blackout_defs] if blackout_defs.is_a?(String)
          unless blackout_defs.join(' ').include?('SQLCIPHER_CRYPTO_CC')
            blackout_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = blackout_defs + ['SQLCIPHER_CRYPTO_CC=1']
          end
          blackout_libs = blackout_config.build_settings['OTHER_LDFLAGS'] || ['$(inherited)']
          blackout_libs = [blackout_libs] if blackout_libs.is_a?(String)
          blackout_config.build_settings['OTHER_LDFLAGS'] = blackout_libs
        end
      end
    end
`;

module.exports = function withSqlcipherCommonCrypto(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes(MARQUEUR)) return config;

      // On s'insere DANS le post_install existant d'Expo : CocoaPods
      // n'en accepte qu'un seul par Podfile.
      const patched = contents.replace(/^(\s*post_install do \|installer\|)$/m, `$1\n${BLOC}`);
      if (patched === contents) {
        throw new Error(
          "withSqlcipherCommonCrypto : bloc 'post_install do |installer|' introuvable dans le Podfile",
        );
      }
      fs.writeFileSync(podfilePath, patched);
      return config;
    },
  ]);
};
