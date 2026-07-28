// Tests de la couche HTTP.
//
// Objectif principal : prouver que le nouveau relais repond EXACTEMENT
// comme l'ancien. Une difference de code de statut suffirait a casser
// les telephones deja installes, qu'on ne peut pas mettre a jour d'un
// claquement de doigts (chaque reinstallation coute un cycle de
// signature de 7 jours).

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, MAX_BODY_BYTES } from '../src/http.js';
import { RelayStore } from '../src/store.js';
import { createNodeSql } from './nodeSql.js';

function contexte() {
  const store = new RelayStore(createNodeSql());
  const pousses = [];
  const appel = (methode, chemin, { token, body } = {}) => {
    const init = { method: methode, headers: {} };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    return handleRequest(new Request(`https://relais.invalid${chemin}`, init), store, (queueId, message) =>
      pousses.push({ queueId, message }),
    );
  };
  return { store, pousses, appel };
}

test('/healthz repond ok', async () => {
  const { appel } = contexte();
  const r = await appel('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('parcours complet : creation, depot, releve, ack', async () => {
  const { appel } = contexte();

  const creation = await appel('POST', '/v1/queues');
  assert.equal(creation.status, 201);
  const { queueId, readToken, writeToken } = await creation.json();

  const depot = await appel('POST', `/v1/queues/${queueId}/messages`, {
    token: writeToken,
    body: { blob: 'octets-opaques' },
  });
  assert.equal(depot.status, 201);
  const { id } = await depot.json();

  const releve = await appel('GET', `/v1/queues/${queueId}/messages`, { token: readToken });
  assert.equal(releve.status, 200);
  const { messages } = await releve.json();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].blob, 'octets-opaques');

  const ack = await appel('DELETE', `/v1/queues/${queueId}/messages/${id}`, { token: readToken });
  assert.equal(ack.status, 204);

  const apres = await appel('GET', `/v1/queues/${queueId}/messages`, { token: readToken });
  assert.deepEqual((await apres.json()).messages, []);
});

test('un depot reussi previent les abonnes WebSocket', async () => {
  const { appel, pousses } = contexte();
  const { queueId, writeToken } = await (await appel('POST', '/v1/queues')).json();

  await appel('POST', `/v1/queues/${queueId}/messages`, { token: writeToken, body: { blob: 'coucou' } });

  assert.equal(pousses.length, 1);
  assert.equal(pousses[0].queueId, queueId);
  assert.equal(pousses[0].message.blob, 'coucou');
});

test('un depot refuse ne previent personne', async () => {
  const { appel, pousses } = contexte();
  const { queueId } = await (await appel('POST', '/v1/queues')).json();

  const r = await appel('POST', `/v1/queues/${queueId}/messages`, {
    token: 'mauvais-token',
    body: { blob: 'intrus' },
  });
  assert.equal(r.status, 403);
  assert.equal(pousses.length, 0);
});

test('sans en-tete Authorization, on obtient 401', async () => {
  const { appel } = contexte();
  const { queueId } = await (await appel('POST', '/v1/queues')).json();
  const r = await appel('GET', `/v1/queues/${queueId}/messages`);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'missing_token' });
});

test('une boite inconnue rend 404', async () => {
  const { appel } = contexte();
  const r = await appel('GET', '/v1/queues/inexistante/messages', { token: 'peu-importe' });
  assert.equal(r.status, 404);
});

test('une boite pleine rend 429', async () => {
  const store = new RelayStore(createNodeSql(), { maxMessagesPerQueue: 1 });
  const appel = (methode, chemin, { token, body } = {}) => {
    const init = { method: methode, headers: token ? { authorization: `Bearer ${token}` } : {} };
    if (body !== undefined) init.body = JSON.stringify(body);
    return handleRequest(new Request(`https://relais.invalid${chemin}`, init), store);
  };
  const { queueId, writeToken } = await (await appel('POST', '/v1/queues')).json();

  await appel('POST', `/v1/queues/${queueId}/messages`, { token: writeToken, body: { blob: 'un' } });
  const trop = await appel('POST', `/v1/queues/${queueId}/messages`, { token: writeToken, body: { blob: 'deux' } });
  assert.equal(trop.status, 429);
  assert.deepEqual(await trop.json(), { error: 'queue_full' });
});

test('un corps qui n est pas du JSON rend 400', async () => {
  const store = new RelayStore(createNodeSql());
  const { queueId, writeToken } = await store.createQueue();
  const r = await handleRequest(
    new Request(`https://relais.invalid/v1/queues/${queueId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${writeToken}` },
      body: 'ceci n est pas du json',
    }),
    store,
  );
  assert.equal(r.status, 400);
});

test('un blob absent ou vide rend 400', async () => {
  const { appel } = contexte();
  const { queueId, writeToken } = await (await appel('POST', '/v1/queues')).json();

  const sansBlob = await appel('POST', `/v1/queues/${queueId}/messages`, { token: writeToken, body: {} });
  assert.equal(sansBlob.status, 400);
  const blobVide = await appel('POST', `/v1/queues/${queueId}/messages`, { token: writeToken, body: { blob: '' } });
  assert.equal(blobVide.status, 400);
});

test('un blob demesure rend 413 sans etre stocke', async () => {
  const { appel, store } = contexte();
  const { queueId, readToken, writeToken } = await (await appel('POST', '/v1/queues')).json();

  const r = await appel('POST', `/v1/queues/${queueId}/messages`, {
    token: writeToken,
    body: { blob: 'x'.repeat(MAX_BODY_BYTES + 1) },
  });
  assert.equal(r.status, 413);
  assert.equal((await store.fetch(queueId, readToken)).messages.length, 0);
});

test('detruire sa boite rend 204 puis 404', async () => {
  const { appel } = contexte();
  const { queueId, readToken } = await (await appel('POST', '/v1/queues')).json();

  assert.equal((await appel('DELETE', `/v1/queues/${queueId}`, { token: readToken })).status, 204);
  assert.equal((await appel('GET', `/v1/queues/${queueId}/messages`, { token: readToken })).status, 404);
});

test('les invitations se deposent et se relisent sans authentification', async () => {
  const { appel } = contexte();
  const depot = await appel('POST', '/v1/invites', { body: { blob: '{"cle":"publique"}' } });
  assert.equal(depot.status, 201);
  const { inviteId } = await depot.json();

  const lecture = await appel('GET', `/v1/invites/${inviteId}`);
  assert.equal(lecture.status, 200);
  assert.equal((await lecture.json()).blob, '{"cle":"publique"}');

  assert.equal((await appel('GET', '/v1/invites/ZZZZZZZZZZZZZZZZ')).status, 404);
});

test('une route inconnue rend 404', async () => {
  const { appel } = contexte();
  assert.equal((await appel('GET', '/v1/nimporte-quoi')).status, 404);
  assert.equal((await appel('GET', '/')).status, 404);
});
