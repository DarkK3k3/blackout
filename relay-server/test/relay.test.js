// Tests d'integration du relais : HTTP + WebSocket + persistance.
// Lances avec le runner natif de Node : `npm test`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createRelayServer } from '../src/server.js';

let relay;
let base;

before(async () => {
  relay = createRelayServer(); // en memoire pure
  const addr = await relay.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await relay.close();
});

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('cycle complet : creation, depot, releve, ack', async () => {
  const { status, json: q } = await api('POST', '/v1/queues');
  assert.equal(status, 201);
  assert.ok(q.queueId && q.readToken && q.writeToken);

  const post = await api('POST', `/v1/queues/${q.queueId}/messages`, {
    token: q.writeToken,
    body: { blob: 'YmxvYi1jaGlmZnJlLW9wYXF1ZQ' },
  });
  assert.equal(post.status, 201);

  const fetch1 = await api('GET', `/v1/queues/${q.queueId}/messages`, { token: q.readToken });
  assert.equal(fetch1.status, 200);
  assert.equal(fetch1.json.messages.length, 1);
  assert.equal(fetch1.json.messages[0].blob, 'YmxvYi1jaGlmZnJlLW9wYXF1ZQ');

  const ack = await api('DELETE', `/v1/queues/${q.queueId}/messages/${post.json.id}`, { token: q.readToken });
  assert.equal(ack.status, 204);

  const fetch2 = await api('GET', `/v1/queues/${q.queueId}/messages`, { token: q.readToken });
  assert.equal(fetch2.json.messages.length, 0);
});

test('les mauvais tokens sont rejetes (lecture ET ecriture)', async () => {
  const { json: q } = await api('POST', '/v1/queues');

  const badWrite = await api('POST', `/v1/queues/${q.queueId}/messages`, {
    token: q.readToken, // le readToken ne permet PAS d'ecrire
    body: { blob: 'eA' },
  });
  assert.equal(badWrite.status, 403);

  const badRead = await api('GET', `/v1/queues/${q.queueId}/messages`, { token: q.writeToken });
  assert.equal(badRead.status, 403);

  const noToken = await api('GET', `/v1/queues/${q.queueId}/messages`);
  assert.equal(noToken.status, 401);
});

test('isolation : une queue ne voit jamais les messages d\'une autre', async () => {
  const { json: qa } = await api('POST', '/v1/queues');
  const { json: qb } = await api('POST', '/v1/queues');

  await api('POST', `/v1/queues/${qa.queueId}/messages`, { token: qa.writeToken, body: { blob: 'cG91ci1B' } });

  const inB = await api('GET', `/v1/queues/${qb.queueId}/messages`, { token: qb.readToken });
  assert.equal(inB.json.messages.length, 0);

  // le token de B ne marche pas sur la queue de A
  const cross = await api('GET', `/v1/queues/${qa.queueId}/messages`, { token: qb.readToken });
  assert.equal(cross.status, 403);
});

test('WebSocket : backlog hors-ligne puis push temps reel, ack via WS', async (t) => {
  const { json: q } = await api('POST', '/v1/queues');

  // depose PENDANT que personne n'ecoute (store-and-forward)
  await api('POST', `/v1/queues/${q.queueId}/messages`, { token: q.writeToken, body: { blob: 'aG9ycy1saWduZQ' } });

  const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/ws`);
  t.after(() => ws.close());
  const received = [];
  const waiters = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    received.push(msg);
    waiters.splice(0).forEach((w) => w());
  });
  const until = (pred) => new Promise((resolve) => {
    const check = () => { if (pred()) resolve(); else waiters.push(check); };
    check();
  });

  await new Promise((resolve) => ws.on('open', resolve));
  ws.send(JSON.stringify({ type: 'subscribe', queueId: q.queueId, token: q.readToken }));

  // 1. backlog recu a la connexion
  await until(() => received.some((m) => m.type === 'message' && m.blob === 'aG9ycy1saWduZQ'));

  // 2. push temps reel d'un nouveau message
  await api('POST', `/v1/queues/${q.queueId}/messages`, { token: q.writeToken, body: { blob: 'dGVtcHMtcmVlbA' } });
  await until(() => received.some((m) => m.type === 'message' && m.blob === 'dGVtcHMtcmVlbA'));

  // 3. ack via WS -> la queue se vide
  for (const m of received.filter((m) => m.type === 'message')) {
    ws.send(JSON.stringify({ type: 'ack', queueId: q.queueId, token: q.readToken, id: m.id }));
  }
  await until(() => received.filter((m) => m.type === 'acked' && m.ok).length === 2);

  const rest = await api('GET', `/v1/queues/${q.queueId}/messages`, { token: q.readToken });
  assert.equal(rest.json.messages.length, 0);
});

test('WebSocket : subscribe avec mauvais token refuse', async (t) => {
  const { json: q } = await api('POST', '/v1/queues');
  const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/ws`);
  t.after(() => ws.close());
  await new Promise((resolve) => ws.on('open', resolve));

  const reply = new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
  ws.send(JSON.stringify({ type: 'subscribe', queueId: q.queueId, token: 'faux-token' }));
  assert.equal((await reply).error, 'forbidden');
});

test('suppression de queue par le destinataire', async () => {
  const { json: q } = await api('POST', '/v1/queues');
  const del = await api('DELETE', `/v1/queues/${q.queueId}`, { token: q.readToken });
  assert.equal(del.status, 204);
  const gone = await api('POST', `/v1/queues/${q.queueId}/messages`, { token: q.writeToken, body: { blob: 'eA' } });
  assert.equal(gone.status, 404);
});

test('persistance : les messages survivent a un redemarrage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blackout-relay-'));
  const dataFile = join(dir, 'data.json');

  const relay1 = createRelayServer({ dataFile });
  const addr1 = await relay1.listen(0, '127.0.0.1');
  const b1 = `http://127.0.0.1:${addr1.port}`;
  const q = await (await fetch(`${b1}/v1/queues`, { method: 'POST' })).json();
  await fetch(`${b1}/v1/queues/${q.queueId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${q.writeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ blob: 'c3Vydml2YW50' }),
  });
  await relay1.close(); // saveNow() force au shutdown

  const relay2 = createRelayServer({ dataFile });
  const addr2 = await relay2.listen(0, '127.0.0.1');
  const b2 = `http://127.0.0.1:${addr2.port}`;
  const res = await fetch(`${b2}/v1/queues/${q.queueId}/messages`, {
    headers: { authorization: `Bearer ${q.readToken}` },
  });
  const { messages } = await res.json();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].blob, 'c3Vydml2YW50');
  await relay2.close();
  rmSync(dir, { recursive: true, force: true });
});

test('healthz repond', async () => {
  const r = await api('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});
