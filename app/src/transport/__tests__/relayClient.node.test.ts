/**
 * @jest-environment node
 *
 * Teste RelayClient contre le VRAI serveur relais (relay-server/),
 * lance en sous-processus sur un port ephemere. Puis un scenario
 * complet : deux "telephones" (SessionManager + stores SQL) qui se
 * parlent REELLEMENT via le relais — chiffrement de bout en bout,
 * le serveur ne voyant que des blobs.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { RelayClient } from '../relayClient';
import { SessionManager } from '../../crypto/sessionManager';
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

afterAll(() => {
  relayProcess.kill();
});

test('API de base : queue, depot, releve, ack', async () => {
  const client = new RelayClient(serverUrl);
  const q = await client.createQueue();

  await client.post(q.queueId, q.writeToken, 'YmxvYg');
  const messages = await client.fetchMessages(q.queueId, q.readToken);
  expect(messages).toHaveLength(1);
  expect(messages[0].blob).toBe('YmxvYg');

  await client.ack(q.queueId, q.readToken, messages[0].id);
  expect(await client.fetchMessages(q.queueId, q.readToken)).toHaveLength(0);
});

test('subscribe : backlog + temps reel + ack', async () => {
  const client = new RelayClient(serverUrl);
  const q = await client.createQueue();
  await client.post(q.queueId, q.writeToken, 'YXZhbnQ'); // depose avant abonnement

  const received: string[] = [];
  const done = new Promise<void>((resolve) => {
    const stop = client.subscribe(
      [{ queueId: q.queueId, readToken: q.readToken }],
      async (message, ack) => {
        received.push(message.blob);
        await ack();
        if (received.length === 2) {
          stop();
          resolve();
        }
      },
    );
  });

  await client.post(q.queueId, q.writeToken, 'YXByZXM'); // pousse en direct
  await done;
  expect(received).toEqual(expect.arrayContaining(['YXZhbnQ', 'YXByZXM']));
  expect(await client.fetchMessages(q.queueId, q.readToken)).toHaveLength(0); // tout acke
}, 15_000);

test('bout en bout REEL : deux telephones via le relais, E2EE totale', async () => {
  const client = new RelayClient(serverUrl);

  // --- deux telephones
  const bob = { store: await BlackoutStore.open(createNodeSqlExecutor()) } as { store: BlackoutStore; manager?: SessionManager };
  const alice = { store: await BlackoutStore.open(createNodeSqlExecutor()) } as { store: BlackoutStore; manager?: SessionManager };
  bob.manager = new SessionManager(nodeSignalBridge, bob.store);
  alice.manager = new SessionManager(nodeSignalBridge, alice.store);

  // --- Bob prepare son invitation : bundle crypto + SA boite d'entree
  await bob.manager.ensureIdentity();
  const bobInbox = await client.createQueue();
  const invite = await bob.manager.createInvite('Bob');
  // (dans l'app : tout ceci part dans le QR code)
  const inviteQr = { ...invite, inbox: { serverUrl, queueId: bobInbox.queueId, writeToken: bobInbox.writeToken } };

  // --- Alice scanne : session + boite d'entree a elle + premier message
  const bobId = await alice.manager.addContactFromInvite(inviteQr);
  const aliceInbox = await client.createQueue();
  await alice.store.saveQueues(bobId, {
    serverUrl,
    inQueueId: aliceInbox.queueId,
    inReadToken: aliceInbox.readToken,
    outQueueId: inviteQr.inbox.queueId,
    outWriteToken: inviteQr.inbox.writeToken,
  });

  const aliceIdentity = await alice.store.getIdentity();
  // premier message : contenu applicatif + infos de rappel (adresse, cle, boite de reponse)
  const firstPayload = JSON.stringify({
    hello: {
      address: aliceIdentity!.localAddress,
      displayName: 'Alice',
      identityKey: aliceIdentity!.publicKey,
      inbox: { serverUrl, queueId: aliceInbox.queueId, writeToken: aliceInbox.writeToken },
    },
    text: 'Salut Bob, via le relais !',
  });
  const envelope = await alice.manager.encryptTo(bobId, new TextEncoder().encode(firstPayload));
  // Le premier message (PREKEY) porte l'adresse pseudonyme de l'expediteur
  // en clair : libsignal lie les adresses a la session, le destinataire en
  // a besoin pour dechiffrer. Les messages suivants n'en portent pas.
  await client.post(
    inviteQr.inbox.queueId,
    inviteQr.inbox.writeToken,
    JSON.stringify({ ...envelope, from: aliceIdentity!.localAddress }),
  );

  // --- Bob releve sa boite : blob opaque -> dechiffre -> contact cree
  const inBobBox = await client.fetchMessages(bobInbox.queueId, bobInbox.readToken);
  expect(inBobBox).toHaveLength(1);
  expect(inBobBox[0].blob).not.toContain('Salut Bob'); // le serveur n'a RIEN vu en clair

  const received = JSON.parse(inBobBox[0].blob);
  // Bob cree la fiche contact avec l'adresse portee par l'enveloppe,
  // dechiffre, puis complete nom + cle d'identite depuis le hello (TOFU).
  const senderId: string = received.from;
  await bob.store.addContact({ id: senderId, displayName: 'en attente', identityKey: '' });
  const plaintext = JSON.parse(
    new TextDecoder().decode(await bob.manager.decryptFrom(senderId, received)),
  );
  await bob.store.updateContactProfile(senderId, plaintext.hello.displayName, plaintext.hello.identityKey);
  expect(plaintext.text).toBe('Salut Bob, via le relais !');
  expect(plaintext.hello.displayName).toBe('Alice');

  await client.ack(bobInbox.queueId, bobInbox.readToken, inBobBox[0].id);

  // --- Bob repond a Alice via SA boite de reponse
  const reply = await bob.manager.encryptTo(senderId, new TextEncoder().encode('Bien recu via le relais !'));
  await client.post(plaintext.hello.inbox.queueId, plaintext.hello.inbox.writeToken, JSON.stringify(reply));

  const inAliceBox = await client.fetchMessages(aliceInbox.queueId, aliceInbox.readToken);
  expect(inAliceBox).toHaveLength(1);
  const replyPlain = new TextDecoder().decode(
    await alice.manager.decryptFrom(bobId, JSON.parse(inAliceBox[0].blob)),
  );
  expect(replyPlain).toBe('Bien recu via le relais !');
}, 60_000);
