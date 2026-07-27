/**
 * @jest-environment node
 *
 * Le test le plus proche de l'usage reel : deux instances completes de
 * l'app (stockage + sessions libsignal + relais lance en sous-processus)
 * qui echangent comme le feraient deux telephones. On verifie le
 * parcours entier : QR d'invitation -> scan -> conversation dans les
 * deux sens -> code de verification -> reception temps reel.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { Blackout } from '../blackout';
import { nodeSignalBridge } from '../../crypto/testutils/nodeSignalBridge';
import { BlackoutStore } from '../../storage/store';
import { createNodeSqlExecutor } from '../../storage/testutils/nodeSqlExecutor';

const RELAY_DIR = join(__dirname, '..', '..', '..', '..', 'relay-server');

let relayProcess: ChildProcess;
let serverUrl: string;

beforeAll(async () => {
  relayProcess = spawn(process.execPath, ['src/server.js'], {
    cwd: RELAY_DIR,
    env: { ...process.env, PORT: '0', DATA_FILE: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  serverUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relais pas demarre')), 45_000);
    relayProcess.stdout!.on('data', (chunk: Buffer) => {
      const m = chunk.toString().match(/ecoute sur :(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
  });
}, 60_000);

afterAll(() => relayProcess.kill());

async function makeApp(name: string) {
  const store = await BlackoutStore.open(createNodeSqlExecutor());
  const app = new Blackout(store, nodeSignalBridge, serverUrl, name);
  await app.init();
  return { app, store };
}

test('parcours complet : invitation, conversation, verification', async () => {
  const bob = await makeApp('Bob');
  const alice = await makeApp('Alice');

  // --- 1. Bob affiche son QR d'invitation
  const invite = await bob.app.createInviteQr();
  expect(invite.payload.v).toBe(1);
  expect(invite.payload.bundle.kyberPreKeyPublic).toBeTruthy(); // PQXDH present

  // --- 2. Alice scanne : contact + session + hello envoye
  const bobId = await alice.app.acceptInviteQr(invite.encoded);
  const aliceChats = await alice.app.listChats();
  expect(aliceChats).toHaveLength(1);
  expect(aliceChats[0].id).toBe(bobId);
  expect(aliceChats[0].verified).toBe(false); // pas encore verifie out-of-band

  // --- 3. Bob releve : le hello cree/complete le contact Alice
  const activity: string[] = [];
  await bob.app.startListening((id) => activity.push(id));
  await waitFor(async () => (await bob.app.listChats()).length === 1);

  const bobChats = await bob.app.listChats();
  const aliceId = bobChats[0].id;
  expect(bobChats[0].title).toBe('Alice'); // nom appris via le hello

  // --- 4. Conversation dans les deux sens
  await alice.app.sendText(bobId, 'On se retrouve ou ce soir ?');
  await waitFor(async () => (await bob.app.listMessages(aliceId)).some((m) => m.body.includes('ce soir')));

  await alice.app.startListening(() => {});
  await bob.app.sendText(aliceId, 'Chez moi, 20h.');
  await waitFor(async () => (await alice.app.listMessages(bobId)).some((m) => m.body === 'Chez moi, 20h.'));

  const aliceThread = await alice.app.listMessages(bobId);
  const sent = aliceThread.find((m) => m.body.includes('ce soir'))!;
  const received = aliceThread.find((m) => m.body === 'Chez moi, 20h.')!;
  expect(sent.mine).toBe(true);
  expect(sent.status).toBe('sent');
  expect(received.mine).toBe(false);

  // --- 5. Code de verification : identique des deux cotes, et stable
  const vAlice = await alice.app.verificationFor(bobId);
  const vBob = await bob.app.verificationFor(aliceId);
  expect(vAlice.code).toBe(vBob.code);
  expect(vAlice.code).toMatch(/^\d{4}-\d{4}$/);
  expect(vAlice.fingerprintHex).toBe(vBob.fingerprintHex);

  // le code d'un autre mois differe, mais l'empreinte ne bouge pas
  const vNextMonth = await alice.app.verificationFor(bobId, new Date(2026, 11, 1));
  expect(vNextMonth.yearMonth).toBe('2026-12');
  expect(vNextMonth.code).not.toBe(vAlice.code);
  expect(vNextMonth.fingerprintHex).toBe(vAlice.fingerprintHex);

  // --- 6. Marquage verifie
  await alice.app.markVerified(bobId);
  expect((await alice.app.listChats())[0].verified).toBe(true);
  // ... et la conversation continue de fonctionner apres verification
  await alice.app.sendText(bobId, 'Nickel !');
  await waitFor(async () => (await bob.app.listMessages(aliceId)).some((m) => m.body === 'Nickel !'));

  alice.app.stopListening();
  bob.app.stopListening();
}, 40_000);

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition non atteinte dans le delai imparti');
}

test('les reglages priment sur les valeurs de compilation', async () => {
  const store = await BlackoutStore.open(createNodeSqlExecutor());

  const defauts = { relayUrl: 'https://valeur-de-compilation.example', displayName: 'Moi' };

  // Sans reglage enregistre, on retombe sur les valeurs du build
  expect(await Blackout.loadSettings(store, defauts)).toEqual(defauts);

  // Une fois enregistres, ce sont eux qui gagnent — sans recompiler
  await Blackout.saveSettings(store, { relayUrl: 'https://mon-relais.example/  ', displayName: '  Kevin ' });
  const charges = await Blackout.loadSettings(store, defauts);
  expect(charges.relayUrl).toBe('https://mon-relais.example'); // espaces et / final nettoyes
  expect(charges.displayName).toBe('Kevin');
});

test('testRelay valide une adresse et rejette ce qui n en est pas une', async () => {
  await expect(Blackout.testRelay('pas-une-url')).rejects.toThrow(/https/);
  await expect(Blackout.testRelay(serverUrl)).resolves.toBeUndefined();
  await expect(Blackout.testRelay(serverUrl + '/v1')).rejects.toThrow();
});

test('une invitation reste possible APRES redemarrage de l app', async () => {
  // Regression : les parties publiques des prekeys n'etaient gardees
  // qu'en memoire vive. Au premier lancement tout marchait ; apres
  // redemarrage, creer un contact devenait impossible — et l'ecran
  // annoncait a tort « relais injoignable ».
  const store = await BlackoutStore.open(createNodeSqlExecutor());

  const premiereOuverture = new Blackout(store, nodeSignalBridge, serverUrl, 'Kevin');
  await premiereOuverture.init();
  const invite1 = await premiereOuverture.createInviteQr();
  expect(invite1.payload.bundle.signedPreKeyPublic).toBeTruthy();

  // Nouvelle instance sur la MEME base = l'app relancee
  const apresRedemarrage = new Blackout(store, nodeSignalBridge, serverUrl, 'Kevin');
  await apresRedemarrage.init();
  const invite2 = await apresRedemarrage.createInviteQr();

  expect(invite2.payload.bundle.signedPreKeyPublic).toBeTruthy();
  expect(invite2.payload.bundle.kyberPreKeyPublic).toBeTruthy();
  // Meme identite : les conversations en cours ne sont pas cassees
  expect(invite2.payload.identityKey).toBe(invite1.payload.identityKey);
  // ... mais une one-time prekey differente a chaque invitation
  expect(invite2.payload.bundle.preKeyId).not.toBe(invite1.payload.bundle.preKeyId);

  // Et l'invitation d'apres redemarrage reste utilisable de bout en bout
  const autre = await makeApp('Autre');
  const contactId = await autre.app.acceptInviteQr(invite2.encoded);
  expect(contactId).toBe(invite2.payload.address);
}, 30_000);

describe('invitation par reference (le bundle ne tient pas dans un QR)', () => {
  it('produit un QR court et un code lisible, et fonctionne de bout en bout', async () => {
    const bob = await makeApp('Bob');
    const alice = await makeApp('Alice');

    const invite = await bob.app.createInviteQr();

    // Le QR doit tenir tres largement sous la limite de 2953 octets
    expect(invite.encoded.length).toBeLessThan(300);
    expect(invite.encoded.startsWith('blackout:1:')).toBe(true);
    // Le code lisible doit rester dictable a voix haute
    expect(invite.spokenCode.length).toBeLessThan(80);
    expect(invite.spokenCode).toMatch(/^[A-Z0-9-]+$/);

    // ... et l'invitation reste pleinement fonctionnelle
    const bobId = await alice.app.acceptInviteQr(invite.encoded);
    expect(bobId).toBe(invite.payload.address);
    expect((await alice.app.listChats())).toHaveLength(1);
  }, 30_000);

  it('REFUSE un bundle substitue par le relais', async () => {
    const bob = await makeApp('Bob');
    const alice = await makeApp('Alice');
    const eve = await makeApp('Eve');

    const vraie = await bob.app.createInviteQr();
    // Eve depose SON bundle sur le relais et le fait passer pour celui
    // de Bob, en gardant l'empreinte annoncee par le QR de Bob.
    const fausse = await eve.app.createInviteQr();
    const qrPiege = vraie.encoded.replace(vraie.reference.inviteId, fausse.reference.inviteId);

    await expect(alice.app.acceptInviteQr(qrPiege)).rejects.toThrow(/empreinte invalide/);
    // Aucun contact n'a ete cree : l'attaque echoue proprement
    expect(await alice.app.listChats()).toHaveLength(0);
  }, 30_000);

  it('rejette un QR qui n est pas une invitation', async () => {
    const alice = await makeApp('Alice');
    await expect(alice.app.acceptInviteQr('https://exemple.fr')).rejects.toThrow(/invitation Blackout/);
    await expect(alice.app.acceptInviteQr('blackout:1:incomplet')).rejects.toThrow(/illisible/);
  });
});

test('le code dicte permet d ajouter un contact sans camera', async () => {
  const bob = await makeApp('Bob');
  const alice = await makeApp('Alice');

  const invite = await bob.app.createInviteQr();

  // On simule une saisie humaine : minuscules, espaces, tirets oublies
  const saisi = invite.spokenCode.toLowerCase().replace(/-/g, ' ');
  const bobId = await alice.app.acceptSpokenCode(saisi);

  expect(bobId).toBe(invite.payload.address);
  expect(await alice.app.listChats()).toHaveLength(1);
}, 30_000);

test('un code dicte errone est rejete sans creer de contact', async () => {
  const alice = await makeApp('Alice');
  await expect(alice.app.acceptSpokenCode('ABC')).rejects.toThrow(/trop court/);
  await expect(alice.app.acceptSpokenCode('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZ')).rejects.toThrow();
  expect(await alice.app.listChats()).toHaveLength(0);
}, 60_000);

test('les messages arrivent SANS redemarrer l app apres un ajout de contact', async () => {
  // Regression : l'abonnement aux boites etait fige au demarrage. Une
  // boite creee ensuite (en affichant ou en acceptant une invitation)
  // n'etait jamais ecoutee — il fallait relancer l'app pour recevoir.
  //
  // Ce test reproduit l'ORDRE REEL de l'application : on ecoute
  // d'abord, on ajoute le contact ensuite. Les tests precedents
  // faisaient l'inverse, ce qui masquait le defaut.
  const bob = await makeApp('Bob');
  const alice = await makeApp('Alice');

  const recus: string[] = [];
  await bob.app.startListening((id) => recus.push(id));
  await alice.app.startListening(() => {});

  // L'invitation cree une boite APRES le debut de l'ecoute
  const invite = await bob.app.createInviteQr();
  const bobId = await alice.app.acceptInviteQr(invite.encoded);

  // Le hello d'Alice doit arriver sans aucun redemarrage
  await waitFor(async () => (await bob.app.listChats()).length === 1);
  const aliceId = (await bob.app.listChats())[0].id;

  // ... et les messages suivants aussi, dans les deux sens
  await alice.app.sendText(bobId, 'premier message apres ajout');
  await waitFor(async () =>
    (await bob.app.listMessages(aliceId)).some((m) => m.body === 'premier message apres ajout'),
  );

  await bob.app.sendText(aliceId, 'reponse immediate');
  await waitFor(async () =>
    (await alice.app.listMessages(bobId)).some((m) => m.body === 'reponse immediate'),
  );

  expect(recus.length).toBeGreaterThan(0);
  alice.app.stopListening();
  bob.app.stopListening();
}, 60_000);
