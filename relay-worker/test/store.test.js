// Tests du store SQL du relais Cloudflare.
//
// Le store tourne ici sur node:sqlite au lieu du SQLite de Cloudflare,
// mais c'est le MEME fichier source que celui deploye : ce qui est
// verifie ici est ce qui tournera en ligne.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayStore, CHUNK_CHARS } from '../src/store.js';
import { createNodeSql } from './nodeSql.js';

function nouveauStore(opts) {
  return new RelayStore(createNodeSql(), opts);
}

test('une boite creee accepte un depot et le rend a son proprietaire', async () => {
  const store = nouveauStore();
  const { queueId, readToken, writeToken } = await store.createQueue();

  const depot = await store.post(queueId, writeToken, 'blob-chiffre');
  assert.equal(depot.status, 'ok');

  const releve = await store.fetch(queueId, readToken);
  assert.equal(releve.status, 'ok');
  assert.equal(releve.messages.length, 1);
  assert.equal(releve.messages[0].blob, 'blob-chiffre');
  assert.equal(releve.messages[0].id, depot.message.id);
});

test('les tokens ne sont pas interchangeables', async () => {
  const store = nouveauStore();
  const { queueId, readToken, writeToken } = await store.createQueue();

  // Le writeToken ne donne pas le droit de LIRE : c'est toute la
  // garantie du modele. L'expediteur depose sans jamais pouvoir
  // relire la boite de son destinataire.
  assert.equal((await store.fetch(queueId, writeToken)).status, 'forbidden');
  assert.equal((await store.post(queueId, readToken, 'x')).status, 'forbidden');
  assert.equal(await store.canRead(queueId, writeToken), false);
  assert.equal(await store.canRead(queueId, readToken), true);
});

test('une boite inconnue est introuvable, pas interdite', async () => {
  const store = nouveauStore();
  assert.equal((await store.fetch('boite-qui-n-existe-pas', 'jeton')).status, 'not_found');
  assert.equal((await store.post('boite-qui-n-existe-pas', 'jeton', 'x')).status, 'not_found');
});

test("l'ack supprime definitivement le message", async () => {
  const store = nouveauStore();
  const { queueId, readToken, writeToken } = await store.createQueue();
  const { message } = await store.post(queueId, writeToken, 'a effacer');

  assert.equal((await store.ack(queueId, readToken, message.id)).status, 'ok');
  assert.equal((await store.fetch(queueId, readToken)).messages.length, 0);
});

test('un ack avec le mauvais token ne supprime rien', async () => {
  const store = nouveauStore();
  const { queueId, readToken, writeToken } = await store.createQueue();
  const { message } = await store.post(queueId, writeToken, 'intact');

  assert.equal((await store.ack(queueId, writeToken, message.id)).status, 'forbidden');
  assert.equal((await store.fetch(queueId, readToken)).messages.length, 1);
});

test('une boite pleine refuse les depots', async () => {
  const store = nouveauStore({ maxMessagesPerQueue: 3 });
  const { queueId, writeToken } = await store.createQueue();

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await store.post(queueId, writeToken, `m${i}`)).status, 'ok');
  }
  assert.equal((await store.post(queueId, writeToken, 'de trop')).status, 'full');
});

test('les messages expires disparaissent', async () => {
  const store = nouveauStore({ messageTtlMs: -1 }); // tout est deja expire
  const { queueId, readToken, writeToken } = await store.createQueue();
  await store.post(queueId, writeToken, 'perime');

  assert.equal((await store.fetch(queueId, readToken)).messages.length, 0);
});

test('un blob plus gros qu une ligne SQLite survit au decoupage', async () => {
  // SQLite refuse toute ligne de plus de 2 Mo dans un Durable Object.
  // Une photo chiffree depasse cette limite : le blob est donc range en
  // morceaux. Ce test verifie qu'il ressort IDENTIQUE, sans quoi le
  // dechiffrement echouerait cote destinataire.
  const store = nouveauStore();
  const { queueId, readToken, writeToken } = await store.createQueue();

  const gros = 'A'.repeat(CHUNK_CHARS * 2 + 12_345);
  await store.post(queueId, writeToken, gros);

  const messages = (await store.fetch(queueId, readToken)).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].blob.length, gros.length);
  assert.equal(messages[0].blob, gros);
});

test("l'ack d'un gros message efface aussi ses morceaux", async () => {
  const sql = createNodeSql();
  const store = new RelayStore(sql);
  const { queueId, readToken, writeToken } = await store.createQueue();
  const { message } = await store.post(queueId, writeToken, 'B'.repeat(CHUNK_CHARS + 1));

  await store.ack(queueId, readToken, message.id);
  const restants = sql.exec('SELECT COUNT(*) AS n FROM chunks').toArray()[0].n;
  assert.equal(restants, 0, 'des morceaux orphelins resteraient stockes pour rien');
});

test('detruire une boite efface son contenu', async () => {
  const sql = createNodeSql();
  const store = new RelayStore(sql);
  const { queueId, readToken, writeToken } = await store.createQueue();
  await store.post(queueId, writeToken, 'au revoir');

  assert.equal((await store.deleteQueue(queueId, readToken)).status, 'ok');
  assert.equal((await store.fetch(queueId, readToken)).status, 'not_found');
  assert.equal(sql.exec('SELECT COUNT(*) AS n FROM messages').toArray()[0].n, 0);
  assert.equal(sql.exec('SELECT COUNT(*) AS n FROM chunks').toArray()[0].n, 0);
});

test('les messages ressortent dans leur ordre de depot', async () => {
  const store = nouveauStore();
  const { queueId, readToken, writeToken } = await store.createQueue();
  for (const corps of ['un', 'deux', 'trois']) {
    await store.post(queueId, writeToken, corps);
  }
  const corps = (await store.fetch(queueId, readToken)).messages.map((m) => m.blob);
  assert.deepEqual(corps, ['un', 'deux', 'trois']);
});

test('deux boites creees a la suite ont des identifiants et des tokens distincts', async () => {
  const store = nouveauStore();
  const a = await store.createQueue();
  const b = await store.createQueue();
  assert.notEqual(a.queueId, b.queueId);
  assert.notEqual(a.readToken, b.readToken);
  assert.notEqual(a.writeToken, b.writeToken);
});

// --- invitations ---

test('une invitation deposee se relit par son identifiant', async () => {
  const store = nouveauStore();
  const { status, inviteId } = await store.putInvite('{"bundle":"public"}');
  assert.equal(status, 'ok');
  assert.equal(inviteId.length, 16);
  assert.match(inviteId, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/, "l'identifiant doit rester dictable");

  const lu = await store.getInvite(inviteId);
  assert.equal(lu.status, 'ok');
  assert.equal(lu.blob, '{"bundle":"public"}');
});

test('une invitation trop grosse est refusee', async () => {
  const store = nouveauStore({ maxInviteBytes: 100 });
  assert.equal((await store.putInvite('x'.repeat(101))).status, 'too_large');
});

test('une invitation expiree devient introuvable', async () => {
  const store = nouveauStore({ inviteTtlMs: -1 });
  const { inviteId } = await store.putInvite('perime');
  assert.equal((await store.getInvite(inviteId)).status, 'not_found');
});

test('une invitation vide est refusee', async () => {
  const store = nouveauStore();
  assert.equal((await store.putInvite('')).status, 'bad_request');
  assert.equal((await store.putInvite(null)).status, 'bad_request');
});
