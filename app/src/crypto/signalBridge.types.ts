// signalBridge.types.ts
// ------------------------------------------------------------------
// Contrat du pont libsignal. Trois implementations STRICTEMENT
// equivalentes (meme coeur Rust de Signal) :
//   - Android : module Expo Kotlin -> org.signal:libsignal-android
//   - iOS     : module Expo Swift  -> LibSignalClient
//   - tests   : adaptateur Node    -> @signalapp/libsignal-client
//     (testutils/nodeSignalBridge.ts, execute par Jest sur la machine
//     de dev — c'est ce qui permet de tester la couche session sans
//     emulateur, avec la vraie crypto de production)
//
// Modele "coeur fonctionnel" (docs/DECISIONS.md) : aucun etat cote
// natif. Les records libsignal (blobs opaques, encodes base64 pour
// passer le pont) entrent en parametres et ressortent mis a jour ;
// leur persistance appartient a la couche storage (SQLCipher).
//
// JAMAIS de crypto maison derriere cette interface.
// ------------------------------------------------------------------

/** Message de premier contact : contient le materiel X3DH/PQXDH. */
export const CIPHERTEXT_WHISPER = 2;
/** Message de session etablie (Double Ratchet ordinaire). */
export const CIPHERTEXT_PREKEY = 3;

/**
 * Bundle PUBLIC publie sur le relais pour permettre a un contact de
 * nous ecrire pendant qu'on est hors-ligne. Ne contient QUE des cles
 * publiques et signatures — publiable sans risque.
 */
export interface PreKeyBundleJson {
  registrationId: number;
  deviceId: number;
  identityKey: string; // base64
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySignature: string;
  /** One-time prekey : consommee au premier message, absente si epuisees. */
  preKeyId?: number;
  preKeyPublic?: string;
  /** Couche post-quantique (PQXDH). */
  kyberPreKeyId: number;
  kyberPreKeyPublic: string;
  kyberPreKeySignature: string;
}

/**
 * Parties PUBLIQUES d'un lot de prekeys. Persistees telles quelles :
 * ce sont elles qui permettent de fabriquer un QR d'invitation apres
 * un redemarrage de l'app.
 */
export interface PreKeyPublics {
  signedPreKey: { id: number; publicKey: string; signature: string };
  preKeys: { id: number; publicKey: string }[];
  kyberPreKey: { id: number; publicKey: string; signature: string };
}

/** Records generes localement. `record` contient du prive -> SQLCipher only. */
export interface GeneratedPreKeys {
  signedPreKey: { id: number; record: string; publicKey: string; signature: string };
  preKeys: { id: number; record: string; publicKey: string }[];
  kyberPreKey: { id: number; record: string; publicKey: string; signature: string };
}

export interface SignalBridge {
  /** Identite stable de l'appareil, generee une fois a l'installation. */
  generateIdentityKeyPair(): Promise<{
    identityRecord: string; // prive — ne quitte jamais l'appareil
    publicKey: string; // celle du QR d'ajout de contact
    registrationId: number;
  }>;

  /** Genere signed prekey + lot de one-time prekeys + kyber prekey, signes par l'identite. */
  generatePreKeys(
    identityRecord: string,
    signedPreKeyId: number,
    preKeyStartId: number,
    preKeyCount: number,
    kyberPreKeyId: number,
  ): Promise<GeneratedPreKeys>;

  /** Cote initiateur : etablit la session (X3DH/PQXDH) depuis le bundle public du contact. */
  processPreKeyBundle(
    identityRecord: string,
    registrationId: number,
    localAddress: string,
    remoteAddress: string,
    bundle: PreKeyBundleJson,
  ): Promise<{ session: string }>;

  /** Chiffre et fait avancer le Double Ratchet d'un cran. */
  encrypt(
    identityRecord: string,
    registrationId: number,
    localAddress: string,
    remoteAddress: string,
    session: string,
    plaintext: string, // base64
  ): Promise<{ type: number; body: string; session: string }>;

  /** Dechiffre un message de session etablie (type WHISPER). */
  decryptWhisper(
    identityRecord: string,
    registrationId: number,
    localAddress: string,
    remoteAddress: string,
    session: string,
    body: string,
  ): Promise<{ plaintext: string; session: string }>;

  /**
   * Dechiffre un message de premier contact (type PREKEY) : termine le
   * X3DH cote destinataire avec ses records de prekeys locaux.
   * `session` peut etre null (toute premiere fois) ou une session
   * existante (bundles retraites en parallele).
   */
  decryptPreKey(
    identityRecord: string,
    registrationId: number,
    localAddress: string,
    remoteAddress: string,
    session: string | null,
    body: string,
    localPreKeys: {
      signedPreKeyRecord: string;
      kyberPreKeyRecord: string;
      preKeyRecords: string[];
    },
  ): Promise<{ plaintext: string; session: string; usedPreKeyId: number | null }>;
}

/**
 * Assemble le bundle publiable a partir des cles generees, en y
 * attachant UNE one-time prekey (une par publication : chaque nouveau
 * contact en consomme une). Fonction pure, cote JS.
 */
export function makePreKeyBundle(
  identityPublicKey: string,
  registrationId: number,
  deviceId: number,
  generated: PreKeyPublics,
  oneTimePreKeyIndex: number | null,
): PreKeyBundleJson {
  const oneTime = oneTimePreKeyIndex === null ? undefined : generated.preKeys[oneTimePreKeyIndex];
  return {
    registrationId,
    deviceId,
    identityKey: identityPublicKey,
    signedPreKeyId: generated.signedPreKey.id,
    signedPreKeyPublic: generated.signedPreKey.publicKey,
    signedPreKeySignature: generated.signedPreKey.signature,
    ...(oneTime ? { preKeyId: oneTime.id, preKeyPublic: oneTime.publicKey } : {}),
    kyberPreKeyId: generated.kyberPreKey.id,
    kyberPreKeyPublic: generated.kyberPreKey.publicKey,
    kyberPreKeySignature: generated.kyberPreKey.signature,
  };
}
