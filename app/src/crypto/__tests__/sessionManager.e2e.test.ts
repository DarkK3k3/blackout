/**
 * @jest-environment node
 *
 * Test de bout en bout de la pile locale : SessionManager +
 * BlackoutStore (SQL reel via node:sqlite) + vrai libsignal (bindings
 * Node officiels). Simule deux telephones complets : invitation par
 * QR, premier message hors-ligne, conversation, persistance des
 * sessions et consommation des one-time prekeys.
 */

import { SessionManager } from '../sessionManager';
import type { InvitePayload } from '../sessionManager';
import { nodeSignalBridge } from '../testutils/nodeSignalBridge';
import { BlackoutStore } from '../../storage/store';
import { createNodeSqlExecutor } from '../../storage/testutils/nodeSqlExecutor';
import { CIPHERTEXT_PREKEY, CIPHERTEXT_WHISPER } from '../signalBridge.types';
import { pairFingerprint, monthlyVerificationCode } from '../verification';

const text = (s: string) => new TextEncoder().encode(s);
const fromBytes = (b: Uint8Array) => new TextDecoder().decode(b);

async function makePhone() {
  const db = createNodeSqlExecutor();
  const store = await BlackoutStore.open(db);
  const manager = new SessionManager(nodeSignalBridge, store);
  return { db, store, manager };
}

describe('pile complete : invitation QR -> conversation chiffree persistee', () => {
  it('deroule le scenario complet entre deux telephones', async () => {
    const bob = await makePhone();
    const alice = await makePhone();

    // --- Bob affiche un QR d'invitation (consomme une one-time prekey)
    const bobIdentity = await bob.manager.ensureIdentity();
    const before = await bob.store.countUnusedOneTimePreKeys();
    const invite: InvitePayload = await bob.manager.createInvite('Bob');
    expect(invite.bundle.preKeyId).toBeDefined();
    expect(invite.bundle.kyberPreKeyPublic).toBeTruthy(); // PQXDH

    // --- Alice scanne : contact pinne + session etablie immediatement
    const bobId = await alice.manager.addContactFromInvite(invite);
    const aliceIdentity = await alice.store.getIdentity();
    expect((await alice.store.getContact(bobId))!.sessionRecord).toBeTruthy();

    // --- Premier message d'Alice, type PREKEY (Bob peut etre hors-ligne)
    const m1 = await alice.manager.encryptTo(bobId, text('Salut Bob, ce message est chiffre !'));
    expect(m1.type).toBe(CIPHERTEXT_PREKEY);

    // --- Bob recoit : il enregistre Alice (infos du protocole) puis dechiffre
    const aliceId = await bob.manager.addContactFromFirstContact({
      address: aliceIdentity!.localAddress,
      displayName: 'Alice',
      identityKey: aliceIdentity!.publicKey,
    });
    const p1 = await bob.manager.decryptFrom(aliceId, m1);
    expect(fromBytes(p1)).toBe('Salut Bob, ce message est chiffre !');

    // La one-time prekey attachee a l'invitation est maintenant consommee
    expect(await bob.store.countUnusedOneTimePreKeys()).toBe(before - 1);

    // --- Aller-retour : la session de Bob est nee du dechiffrement
    const m2 = await bob.manager.encryptTo(aliceId, text('Bien recu Alice !'));
    expect(fromBytes(await alice.manager.decryptFrom(bobId, m2))).toBe('Bien recu Alice !');

    // Apres l'aller-retour, messages WHISPER ordinaires
    const m3 = await alice.manager.encryptTo(bobId, text('Ca va super !'));
    expect(m3.type).toBe(CIPHERTEXT_WHISPER);
    expect(fromBytes(await bob.manager.decryptFrom(aliceId, m3))).toBe('Ca va super !');

    // --- Les sessions sont bien PERSISTEES : on rouvre des managers
    //     neufs sur les memes bases (equivalent d'un redemarrage d'app)
    const bob2 = new SessionManager(nodeSignalBridge, bob.store);
    const alice2 = new SessionManager(nodeSignalBridge, alice.store);
    const m4 = await alice2.encryptTo(bobId, text('apres redemarrage'));
    expect(fromBytes(await bob2.decryptFrom(aliceId, m4))).toBe('apres redemarrage');

    // --- Le code de verification mensuel des deux cotes est identique
    //     et n'a pas bouge malgre toute la conversation
    const fpAlice = pairFingerprint(b64ToBytes(aliceIdentity!.publicKey), b64ToBytes(invite.identityKey));
    const fpBob = pairFingerprint(b64ToBytes(invite.identityKey), b64ToBytes(aliceIdentity!.publicKey));
    expect(monthlyVerificationCode(fpAlice, '2026-07')).toBe(monthlyVerificationCode(fpBob, '2026-07'));
  });

  it("messages hors-ordre a travers la pile persistee", async () => {
    const bob = await makePhone();
    const alice = await makePhone();

    await bob.manager.ensureIdentity();
    const invite = await bob.manager.createInvite('Bob');
    const bobId = await alice.manager.addContactFromInvite(invite);
    const aliceIdentity = await alice.store.getIdentity();
    const aliceId = await bob.manager.addContactFromFirstContact({
      address: aliceIdentity!.localAddress,
      displayName: 'Alice',
      identityKey: aliceIdentity!.publicKey,
    });
    await bob.manager.decryptFrom(aliceId, await alice.manager.encryptTo(bobId, text('ouverture')));

    const e1 = await alice.manager.encryptTo(bobId, text('premier'));
    const e2 = await alice.manager.encryptTo(bobId, text('deuxieme'));
    const e3 = await alice.manager.encryptTo(bobId, text('troisieme'));

    expect(fromBytes(await bob.manager.decryptFrom(aliceId, e3))).toBe('troisieme');
    expect(fromBytes(await bob.manager.decryptFrom(aliceId, e1))).toBe('premier');
    expect(fromBytes(await bob.manager.decryptFrom(aliceId, e2))).toBe('deuxieme');
  });

  it('le fan-out de groupe chiffre une copie par membre, dechiffrable par lui seul', async () => {
    const alice = await makePhone();
    const bob = await makePhone();
    const carol = await makePhone();

    // Alice ajoute Bob et Carol via leurs invitations respectives
    await bob.manager.ensureIdentity();
    await carol.manager.ensureIdentity();
    const bobId = await alice.manager.addContactFromInvite(await bob.manager.createInvite('Bob'));
    const carolId = await alice.manager.addContactFromInvite(await carol.manager.createInvite('Carol'));

    // Fan-out : un message de groupe = une copie chiffree PAR MEMBRE
    const groupMessage = 'Soiree vendredi, tout le monde est la ?';
    const forBob = await alice.manager.encryptTo(bobId, text(groupMessage));
    const forCarol = await alice.manager.encryptTo(carolId, text(groupMessage));
    expect(forBob.body).not.toBe(forCarol.body); // sessions et cles differentes

    const aliceIdentity = await alice.store.getIdentity();
    const aliceInfo = {
      address: aliceIdentity!.localAddress,
      displayName: 'Alice',
      identityKey: aliceIdentity!.publicKey,
    };
    const aliceIdForBob = await bob.manager.addContactFromFirstContact(aliceInfo);
    const aliceIdForCarol = await carol.manager.addContactFromFirstContact(aliceInfo);

    expect(fromBytes(await bob.manager.decryptFrom(aliceIdForBob, forBob))).toBe(groupMessage);
    expect(fromBytes(await carol.manager.decryptFrom(aliceIdForCarol, forCarol))).toBe(groupMessage);

    // La copie de Bob est indechiffrable par Carol (mauvaise session)
    await expect(carol.manager.decryptFrom(aliceIdForCarol, forBob)).rejects.toThrow();
  });
});

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}
