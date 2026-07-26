// gen-verification-vectors.js
// ------------------------------------------------------------------
// Genere des vecteurs de test de reference pour le port TypeScript
// de verification.js, en utilisant le PROTOTYPE (libsodium) comme
// verite terrain. Le test Jest de l'app doit reproduire exactement
// ces valeurs, ce qui prouve que le port est fidele bit a bit.
//
// Usage : node tools/gen-verification-vectors.js
// (les dependances viennent de crypto-prototype/node_modules)
// ------------------------------------------------------------------

const path = require('path');
const fs = require('fs');

const PROTO_DIR = path.join(__dirname, '..', '..', 'crypto-prototype');
const sodium = require(path.join(PROTO_DIR, 'node_modules', 'libsodium-wrappers'));
const { pairFingerprint, monthlyVerificationCode } = require(path.join(PROTO_DIR, 'verification.js'));

const OUT = path.join(__dirname, '..', 'app', 'src', 'crypto', '__tests__', 'verification.vectors.json');

const MONTHS = ['2025-12', '2026-01', '2026-07', '2026-08', '2030-11'];

async function main() {
  await sodium.ready;
  const vectors = [];

  for (let i = 0; i < 6; i++) {
    const a = sodium.crypto_box_keypair().publicKey;
    const b = sodium.crypto_box_keypair().publicKey;

    const fp = pairFingerprint(a, b);
    const fpSwapped = pairFingerprint(b, a); // doit etre identique

    const codes = {};
    for (const m of MONTHS) codes[m] = monthlyVerificationCode(fp, m);

    vectors.push({
      aPublicHex: sodium.to_hex(a),
      bPublicHex: sodium.to_hex(b),
      fingerprintHex: sodium.to_hex(fp),
      fingerprintSwappedHex: sodium.to_hex(fpSwapped),
      codes,
    });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ months: MONTHS, vectors }, null, 2));
  console.log(`${vectors.length} vecteurs ecrits dans ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
