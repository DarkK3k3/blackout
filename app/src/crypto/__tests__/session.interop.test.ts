/**
 * @jest-environment node
 *
 * Tests d'interop de la couche session avec le VRAI libsignal
 * (bindings Node officiels, meme coeur Rust que le module natif).
 * Rejoue les scenarios du prototype (demo.js) et ce que le prototype
 * ne savait pas faire (messages hors-ordre), a travers le contrat
 * SignalBridge que le module natif Kotlin/Swift implemente.
 */

import { nodeSignalBridge as bridge } from '../testutils/nodeSignalBridge';
import {
  makePreKeyBundle,
  CIPHERTEXT_PREKEY,
  CIPHERTEXT_WHISPER,
} from '../signalBridge.types';
import { pairFingerprint, monthlyVerificationCode } from '../verification';

const text = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const fromText = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

/** Simule un appareil : identite + prekeys + etat de session persiste. */
async function makeDevice(address: string) {
  const identity = await bridge.generateIdentityKeyPair();
  const preKeys = await bridge.generatePreKeys(identity.identityRecord, 1, 100, 10, 1);
  return {
    address,
    identity,
    preKeys,
    session: null as string | null,
    /** Ce que cet appareil publie sur le relais (public uniquement). */
    publishBundle(oneTimeIndex: number) {
      return makePreKeyBundle(identity.publicKey, identity.registrationId, 1, preKeys, oneTimeIndex);
    },
  };
}

type Device = Awaited<ReturnType<typeof makeDevice>>;

async function send(from: Device, to: Device, message: string) {
  const r = await bridge.encrypt(
    from.identity.identityRecord, from.identity.registrationId,
    from.address, to.address, from.session!, text(message),
  );
  from.session = r.session;
  return r;
}

async function receive(to: Device, from: Device, envelope: { type: number; body: string }) {
  if (envelope.type === CIPHERTEXT_PREKEY) {
    const r = await bridge.decryptPreKey(
      to.identity.identityRecord, to.identity.registrationId,
      to.address, from.address, to.session, envelope.body,
      {
        signedPreKeyRecord: to.preKeys.signedPreKey.record,
        kyberPreKeyRecord: to.preKeys.kyberPreKey.record,
        preKeyRecords: to.preKeys.preKeys.map((p) => p.record),
      },
    );
    to.session = r.session;
    return { plaintext: fromText(r.plaintext), usedPreKeyId: r.usedPreKeyId };
  }
  const r = await bridge.decryptWhisper(
    to.identity.identityRecord, to.identity.registrationId,
    to.address, from.address, to.session!, envelope.body,
  );
  to.session = r.session;
  return { plaintext: fromText(r.plaintext), usedPreKeyId: null };
}

describe('couche session libsignal (X3DH/PQXDH + Double Ratchet)', () => {
  it('etablit une session via bundle et fait un aller-retour complet (etapes 2-5 du demo)', async () => {
    const alice = await makeDevice('alice-uuid');
    const bob = await makeDevice('bob-uuid');

    // Bob est hors-ligne : Alice recupere son bundle publie sur le relais
    const bundle = bob.publishBundle(0);
    expect(bundle.kyberPreKeyPublic).toBeTruthy(); // PQXDH bien present
    const s = await bridge.processPreKeyBundle(
      alice.identity.identityRecord, alice.identity.registrationId,
      alice.address, bob.address, bundle,
    );
    alice.session = s.session;

    // Premier message : type PREKEY (contient le materiel de handshake)
    const m1 = await send(alice, bob, 'Salut Bob, ce message est chiffre !');
    expect(m1.type).toBe(CIPHERTEXT_PREKEY);
    expect(m1.body).not.toContain(text('Salut Bob')); // pas de fuite en clair

    const r1 = await receive(bob, alice, m1);
    expect(r1.plaintext).toBe('Salut Bob, ce message est chiffre !');
    expect(r1.usedPreKeyId).toBe(100); // la one-time prekey attachee au bundle

    // Reponse de Bob : la session est etablie, DH ratchet tourne
    const m2 = await send(bob, alice, 'Salut Alice, bien recu, et toi ?');
    const r2 = await receive(alice, bob, m2);
    expect(r2.plaintext).toBe('Salut Alice, bien recu, et toi ?');

    // Apres l'aller-retour, plus de PREKEY : messages WHISPER ordinaires
    const m3 = await send(alice, bob, 'Ca va super !');
    expect(m3.type).toBe(CIPHERTEXT_WHISPER);
    expect((await receive(bob, alice, m3)).plaintext).toBe('Ca va super !');
  });

  it('enchaine plusieurs messages dans le meme sens (etape 6 du demo)', async () => {
    const alice = await makeDevice('alice-uuid');
    const bob = await makeDevice('bob-uuid');
    alice.session = (await bridge.processPreKeyBundle(
      alice.identity.identityRecord, alice.identity.registrationId,
      alice.address, bob.address, bob.publishBundle(1),
    )).session;

    const first = await send(alice, bob, 'ouverture');
    await receive(bob, alice, first);

    for (const msg of ['Message 1', 'Message 2', 'Message 3']) {
      const env = await send(alice, bob, msg);
      expect((await receive(bob, alice, env)).plaintext).toBe(msg);
    }
    // et dans l'autre sens
    for (const msg of ['Reponse 1', 'Reponse 2']) {
      const env = await send(bob, alice, msg);
      expect((await receive(alice, bob, env)).plaintext).toBe(msg);
    }
  });

  it('gere les messages recus HORS-ORDRE (ce que le prototype ne savait pas faire)', async () => {
    const alice = await makeDevice('alice-uuid');
    const bob = await makeDevice('bob-uuid');
    alice.session = (await bridge.processPreKeyBundle(
      alice.identity.identityRecord, alice.identity.registrationId,
      alice.address, bob.address, bob.publishBundle(2),
    )).session;
    await receive(bob, alice, await send(alice, bob, 'ouverture'));

    // Alice envoie 3 messages ; le reseau les livre dans le desordre
    const e1 = await send(alice, bob, 'premier');
    const e2 = await send(alice, bob, 'deuxieme');
    const e3 = await send(alice, bob, 'troisieme');

    expect((await receive(bob, alice, e3)).plaintext).toBe('troisieme');
    expect((await receive(bob, alice, e1)).plaintext).toBe('premier');
    expect((await receive(bob, alice, e2)).plaintext).toBe('deuxieme');
  });

  it('chaque message produit un ciphertext different, meme pour un texte identique', async () => {
    const alice = await makeDevice('alice-uuid');
    const bob = await makeDevice('bob-uuid');
    alice.session = (await bridge.processPreKeyBundle(
      alice.identity.identityRecord, alice.identity.registrationId,
      alice.address, bob.address, bob.publishBundle(3),
    )).session;
    await receive(bob, alice, await send(alice, bob, 'ouverture'));

    const a = await send(alice, bob, 'texte identique');
    const b = await send(alice, bob, 'texte identique');
    expect(a.body).not.toBe(b.body); // cle differente a chaque message (symmetric ratchet)
    expect((await receive(bob, alice, a)).plaintext).toBe('texte identique');
    expect((await receive(bob, alice, b)).plaintext).toBe('texte identique');
  });

  it("un tiers avec sa propre identite ne peut pas dechiffrer (l'etat de session ne fuit pas)", async () => {
    const alice = await makeDevice('alice-uuid');
    const bob = await makeDevice('bob-uuid');
    const eve = await makeDevice('eve-uuid');
    alice.session = (await bridge.processPreKeyBundle(
      alice.identity.identityRecord, alice.identity.registrationId,
      alice.address, bob.address, bob.publishBundle(4),
    )).session;

    const env = await send(alice, bob, 'secret pour Bob uniquement');
    await expect(
      bridge.decryptPreKey(
        eve.identity.identityRecord, eve.identity.registrationId,
        eve.address, alice.address, null, env.body,
        {
          signedPreKeyRecord: eve.preKeys.signedPreKey.record,
          kyberPreKeyRecord: eve.preKeys.kyberPreKey.record,
          preKeyRecords: eve.preKeys.preKeys.map((p) => p.record),
        },
      ),
    ).rejects.toThrow(); // Eve n'a pas les cles privees du bundle utilise
  });

  it('le code de verification mensuel reste independant de la session (etape 8 du demo)', async () => {
    const alice = await makeDevice('alice-uuid');
    const bob = await makeDevice('bob-uuid');

    const fpBefore = pairFingerprint(
      Uint8Array.from(Buffer.from(alice.identity.publicKey, 'base64')),
      Uint8Array.from(Buffer.from(bob.identity.publicKey, 'base64')),
    );
    const codeBefore = monthlyVerificationCode(fpBefore, '2026-07');

    // Toute une conversation, avec DH ratchet steps...
    alice.session = (await bridge.processPreKeyBundle(
      alice.identity.identityRecord, alice.identity.registrationId,
      alice.address, bob.address, bob.publishBundle(5),
    )).session;
    await receive(bob, alice, await send(alice, bob, 'un'));
    await receive(alice, bob, await send(bob, alice, 'deux'));
    await receive(bob, alice, await send(alice, bob, 'trois'));

    // ...et le code n'a pas bouge : il ne depend que des identites + du mois
    const fpAfter = pairFingerprint(
      Uint8Array.from(Buffer.from(alice.identity.publicKey, 'base64')),
      Uint8Array.from(Buffer.from(bob.identity.publicKey, 'base64')),
    );
    expect(monthlyVerificationCode(fpAfter, '2026-07')).toBe(codeBefore);
  });
});
