// nodeSignalBridge.ts — TESTS UNIQUEMENT (devDependency)
// ------------------------------------------------------------------
// Implementation du SignalBridge avec les bindings Node OFFICIELS de
// Signal (@signalapp/libsignal-client). Meme coeur Rust que les libs
// Android/iOS du module natif : ce que ces tests prouvent sur la
// machine de dev vaut pour le protocole embarque sur telephone.
//
// Ne JAMAIS importer ce fichier depuis le code de l'app : il depend
// d'un module natif Node, inexistant sous Hermes/React Native.
// ------------------------------------------------------------------

import {
  CiphertextMessageType,
  Direction,
  IdentityChange,
  IdentityKeyStore,
  KEMKeyPair,
  KyberPreKeyRecord,
  KyberPreKeyStore,
  PreKeyBundle,
  PreKeyRecord,
  PreKeySignalMessage,
  PreKeyStore,
  ProtocolAddress,
  PublicKey,
  KEMPublicKey,
  SessionRecord,
  SessionStore,
  SignalMessage,
  SignedPreKeyRecord,
  SignedPreKeyStore,
  IdentityKeyPair,
  PrivateKey,
  processPreKeyBundle,
  signalEncrypt,
  signalDecrypt,
  signalDecryptPreKey,
} from '@signalapp/libsignal-client';
import type { SignalBridge, PreKeyBundleJson, GeneratedPreKeys } from '../signalBridge.types';

type Bytes = Uint8Array<ArrayBuffer>;
const fromB64 = (s: string): Bytes => Uint8Array.from(Buffer.from(s, 'base64'));
const toB64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

// --- Stores ephemeres : reconstruits a chaque appel depuis les records ---
// La confiance dans les identites n'est PAS decidee ici : elle est
// geree par la couche app (verification QR out-of-band). Ces stores
// in-memory acceptent donc toute identite.

class MemSessionStore extends SessionStore {
  sessions = new Map<string, SessionRecord>();
  async saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void> {
    this.sessions.set(name.name(), record);
  }
  async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
    return this.sessions.get(name.name()) ?? null;
  }
  async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
    return addresses
      .map((a) => this.sessions.get(a.name()))
      .filter((s): s is SessionRecord => s !== undefined);
  }
}

class MemIdentityStore extends IdentityKeyStore {
  identities = new Map<string, PublicKey>();
  constructor(private keyPair: IdentityKeyPair, private registrationId: number) {
    super();
  }
  async getIdentityKey(): Promise<PrivateKey> {
    return this.keyPair.privateKey;
  }
  async getLocalRegistrationId(): Promise<number> {
    return this.registrationId;
  }
  async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<IdentityChange> {
    const prev = this.identities.get(name.name());
    this.identities.set(name.name(), key);
    return prev && !prev.equals(key) ? IdentityChange.ReplacedExisting : IdentityChange.NewOrUnchanged;
  }
  async isTrustedIdentity(_name: ProtocolAddress, _key: PublicKey, _direction: Direction): Promise<boolean> {
    return true; // pinning des identites gere par la couche app (QR)
  }
  async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
    return this.identities.get(name.name()) ?? null;
  }
}

class MemPreKeyStore extends PreKeyStore {
  records = new Map<number, PreKeyRecord>();
  removed: number[] = [];
  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    this.records.set(id, record);
  }
  async getPreKey(id: number): Promise<PreKeyRecord> {
    const r = this.records.get(id);
    if (!r) throw new Error(`prekey ${id} introuvable`);
    return r;
  }
  async removePreKey(id: number): Promise<void> {
    this.records.delete(id);
    this.removed.push(id);
  }
}

class MemSignedPreKeyStore extends SignedPreKeyStore {
  records = new Map<number, SignedPreKeyRecord>();
  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    this.records.set(id, record);
  }
  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const r = this.records.get(id);
    if (!r) throw new Error(`signed prekey ${id} introuvable`);
    return r;
  }
}

class MemKyberPreKeyStore extends KyberPreKeyStore {
  records = new Map<number, KyberPreKeyRecord>();
  async saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    this.records.set(id, record);
  }
  async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const r = this.records.get(id);
    if (!r) throw new Error(`kyber prekey ${id} introuvable`);
    return r;
  }
  async markKyberPreKeyUsed(): Promise<void> {
    // one-time kyber prekeys : viendra avec la rotation, no-op en v1
  }
}

function makeStores(identityRecord: string, registrationId: number) {
  const keyPair = IdentityKeyPair.deserialize(fromB64(identityRecord));
  return {
    sessionStore: new MemSessionStore(),
    identityStore: new MemIdentityStore(keyPair, registrationId),
    keyPair,
  };
}

function bundleFromJson(b: PreKeyBundleJson): PreKeyBundle {
  return PreKeyBundle.new(
    b.registrationId,
    b.deviceId,
    b.preKeyId ?? null,
    b.preKeyPublic ? PublicKey.deserialize(fromB64(b.preKeyPublic)) : null,
    b.signedPreKeyId,
    PublicKey.deserialize(fromB64(b.signedPreKeyPublic)),
    fromB64(b.signedPreKeySignature),
    PublicKey.deserialize(fromB64(b.identityKey)),
    b.kyberPreKeyId,
    KEMPublicKey.deserialize(fromB64(b.kyberPreKeyPublic)),
    fromB64(b.kyberPreKeySignature),
  );
}

export const nodeSignalBridge: SignalBridge = {
  async generateIdentityKeyPair() {
    const keyPair = IdentityKeyPair.generate();
    // registration id : 14 bits non nuls, comme KeyHelper de libsignal
    const registrationId = 1 + Math.floor(Math.random() * 16380);
    return {
      identityRecord: toB64(keyPair.serialize()),
      publicKey: toB64(keyPair.publicKey.serialize()),
      registrationId,
    };
  },

  async generatePreKeys(identityRecord, signedPreKeyId, preKeyStartId, preKeyCount, kyberPreKeyId) {
    const identity = IdentityKeyPair.deserialize(fromB64(identityRecord));
    const now = Date.now();

    const spkPrivate = PrivateKey.generate();
    const spkPublic = spkPrivate.getPublicKey();
    const spkSignature = identity.privateKey.sign(spkPublic.serialize());
    const signedPreKey = SignedPreKeyRecord.new(signedPreKeyId, now, spkPublic, spkPrivate, spkSignature);

    const preKeys = [];
    for (let i = 0; i < preKeyCount; i++) {
      const priv = PrivateKey.generate();
      const rec = PreKeyRecord.new(preKeyStartId + i, priv.getPublicKey(), priv);
      preKeys.push({
        id: preKeyStartId + i,
        record: toB64(rec.serialize()),
        publicKey: toB64(priv.getPublicKey().serialize()),
      });
    }

    const kemPair = KEMKeyPair.generate();
    const kyberSignature = identity.privateKey.sign(kemPair.getPublicKey().serialize());
    const kyberPreKey = KyberPreKeyRecord.new(kyberPreKeyId, now, kemPair, kyberSignature);

    return {
      signedPreKey: {
        id: signedPreKeyId,
        record: toB64(signedPreKey.serialize()),
        publicKey: toB64(spkPublic.serialize()),
        signature: toB64(spkSignature),
      },
      preKeys,
      kyberPreKey: {
        id: kyberPreKeyId,
        record: toB64(kyberPreKey.serialize()),
        publicKey: toB64(kemPair.getPublicKey().serialize()),
        signature: toB64(kyberSignature),
      },
    } satisfies GeneratedPreKeys;
  },

  async processPreKeyBundle(identityRecord, registrationId, localAddress, remoteAddress, bundle) {
    const { sessionStore, identityStore } = makeStores(identityRecord, registrationId);
    const remote = ProtocolAddress.new(remoteAddress, bundle.deviceId);
    const local = ProtocolAddress.new(localAddress, 1);
    await processPreKeyBundle(bundleFromJson(bundle), remote, local, sessionStore, identityStore);
    const session = await sessionStore.getSession(remote);
    if (!session) throw new Error('session absente apres processPreKeyBundle');
    return { session: toB64(session.serialize()) };
  },

  async encrypt(identityRecord, registrationId, localAddress, remoteAddress, session, plaintext) {
    const { sessionStore, identityStore } = makeStores(identityRecord, registrationId);
    const remote = ProtocolAddress.new(remoteAddress, 1);
    const local = ProtocolAddress.new(localAddress, 1);
    await sessionStore.saveSession(remote, SessionRecord.deserialize(fromB64(session)));

    const ciphertext = await signalEncrypt(fromB64(plaintext), remote, local, sessionStore, identityStore);
    const updated = await sessionStore.getSession(remote);
    return {
      type: ciphertext.type(),
      body: toB64(ciphertext.serialize()),
      session: toB64(updated!.serialize()),
    };
  },

  async decryptWhisper(identityRecord, registrationId, localAddress, remoteAddress, session, body) {
    const { sessionStore, identityStore } = makeStores(identityRecord, registrationId);
    const remote = ProtocolAddress.new(remoteAddress, 1);
    const local = ProtocolAddress.new(localAddress, 1);
    await sessionStore.saveSession(remote, SessionRecord.deserialize(fromB64(session)));

    const message = SignalMessage.deserialize(fromB64(body));
    const plaintext = await signalDecrypt(message, remote, local, sessionStore, identityStore);
    const updated = await sessionStore.getSession(remote);
    return { plaintext: toB64(plaintext), session: toB64(updated!.serialize()) };
  },

  async decryptPreKey(identityRecord, registrationId, localAddress, remoteAddress, session, body, localPreKeys) {
    const { sessionStore, identityStore } = makeStores(identityRecord, registrationId);
    const remote = ProtocolAddress.new(remoteAddress, 1);
    const local = ProtocolAddress.new(localAddress, 1);
    if (session) await sessionStore.saveSession(remote, SessionRecord.deserialize(fromB64(session)));

    const preKeyStore = new MemPreKeyStore();
    for (const rec of localPreKeys.preKeyRecords) {
      const r = PreKeyRecord.deserialize(fromB64(rec));
      await preKeyStore.savePreKey(r.id(), r);
    }
    const signedPreKeyStore = new MemSignedPreKeyStore();
    const spk = SignedPreKeyRecord.deserialize(fromB64(localPreKeys.signedPreKeyRecord));
    await signedPreKeyStore.saveSignedPreKey(spk.id(), spk);
    const kyberStore = new MemKyberPreKeyStore();
    const kpk = KyberPreKeyRecord.deserialize(fromB64(localPreKeys.kyberPreKeyRecord));
    await kyberStore.saveKyberPreKey(kpk.id(), kpk);

    const message = PreKeySignalMessage.deserialize(fromB64(body));
    const plaintext = await signalDecryptPreKey(
      message, remote, local, sessionStore, identityStore, preKeyStore, signedPreKeyStore, kyberStore,
    );
    const updated = await sessionStore.getSession(remote);
    return {
      plaintext: toB64(plaintext),
      session: toB64(updated!.serialize()),
      usedPreKeyId: message.preKeyId(),
    };
  },
};

export { CiphertextMessageType };
