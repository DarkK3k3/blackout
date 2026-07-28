// Tests contre un relais REELLEMENT en train de tourner.
//
// Les autres tests verifient la logique dans Node. Ceux-ci verifient ce
// que Node ne peut pas voir : le comportement du moteur Cloudflare
// lui-meme, et surtout les WebSockets en mode hibernation — le seul
// endroit du relais ou une variable d'instance survivrait en Node mais
// disparaitrait en production.
//
// Lancer le relais dans un terminal :   npm run dev
// puis dans un autre :                  npm run test:live
//
// Sans BLACKOUT_WORKER_URL, ces tests sont ignores plutot qu'echoues.

import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BLACKOUT_WORKER_URL;
const options = { skip: BASE ? false : 'BLACKOUT_WORKER_URL non defini' };

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}

/** Ouvre une socket et resout quand elle est prete. */
function openSocket() {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/v1/ws`);
  const recus = [];
  const attentes = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    recus.push(msg);
    for (let i = attentes.length - 1; i >= 0; i -= 1) {
      if (attentes[i].predicat(msg)) attentes.splice(i, 1)[0].resoudre(msg);
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () =>
      resolve({
        envoyer: (o) => ws.send(JSON.stringify(o)),
        fermer: () => ws.close(),
        /** Attend un message satisfaisant le predicat (5 s max). */
        attendre: (predicat) =>
          new Promise((res, rej) => {
            const dejaRecu = recus.find(predicat);
            if (dejaRecu) return res(dejaRecu);
            const minuteur = setTimeout(() => rej(new Error('aucun message attendu recu en 5 s')), 5000);
            attentes.push({ predicat, resoudre: (m) => (clearTimeout(minuteur), res(m)) });
            return undefined;
          }),
      }),
    );
  });
}

test('le relais en ligne repond sur /healthz', options, async () => {
  const r = await api('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
});

test('une socket ne recoit rien sans avoir prouve son droit de lecture', options, async () => {
  const { queueId } = (await api('POST', '/v1/queues')).body;
  const socket = await openSocket();

  socket.envoyer({ type: 'subscribe', queueId, token: 'token-invente' });
  const reponse = await socket.attendre((m) => m.type === 'error');
  assert.equal(reponse.error, 'forbidden');
  socket.fermer();
});

test('un message deposé arrive en temps reel sur la socket abonnee', options, async () => {
  const { queueId, readToken, writeToken } = (await api('POST', '/v1/queues')).body;
  const socket = await openSocket();

  socket.envoyer({ type: 'subscribe', queueId, token: readToken });
  await socket.attendre((m) => m.type === 'subscribed');

  await api('POST', `/v1/queues/${queueId}/messages`, { token: writeToken, body: { blob: 'en-direct' } });
  const recu = await socket.attendre((m) => m.type === 'message');

  assert.equal(recu.queueId, queueId);
  assert.equal(recu.blob, 'en-direct');
  socket.fermer();
});

test("l'abonnement delivre ce qui attendait pendant l'absence", options, async () => {
  const { queueId, readToken, writeToken } = (await api('POST', '/v1/queues')).body;
  // Depose AVANT toute connexion : c'est le cas du telephone eteint.
  await api('POST', `/v1/queues/${queueId}/messages`, { token: writeToken, body: { blob: 'en-attente' } });

  const socket = await openSocket();
  socket.envoyer({ type: 'subscribe', queueId, token: readToken });
  const recu = await socket.attendre((m) => m.type === 'message');

  assert.equal(recu.blob, 'en-attente');
  socket.fermer();
});

test("l'ack passe par la socket et vide la boite", options, async () => {
  const { queueId, readToken, writeToken } = (await api('POST', '/v1/queues')).body;
  const { body } = await api('POST', `/v1/queues/${queueId}/messages`, {
    token: writeToken,
    body: { blob: 'a-acquitter' },
  });

  const socket = await openSocket();
  socket.envoyer({ type: 'subscribe', queueId, token: readToken });
  await socket.attendre((m) => m.type === 'subscribed');

  socket.envoyer({ type: 'ack', queueId, token: readToken, id: body.id });
  const acquitte = await socket.attendre((m) => m.type === 'acked');
  assert.equal(acquitte.ok, true);

  const restants = await api('GET', `/v1/queues/${queueId}/messages`, { token: readToken });
  assert.deepEqual(restants.body.messages, []);
  socket.fermer();
});

test('une socket abonnee a deux boites recoit les deux', options, async () => {
  // L'app n'ouvre qu'UNE socket pour tous ses contacts : si cet
  // abonnement multiple cassait, il faudrait redemarrer l'app pour
  // recevoir — exactement le defaut corrige il y a peu.
  const a = (await api('POST', '/v1/queues')).body;
  const b = (await api('POST', '/v1/queues')).body;
  const socket = await openSocket();

  socket.envoyer({ type: 'subscribe', queueId: a.queueId, token: a.readToken });
  await socket.attendre((m) => m.type === 'subscribed' && m.queueId === a.queueId);
  socket.envoyer({ type: 'subscribe', queueId: b.queueId, token: b.readToken });
  await socket.attendre((m) => m.type === 'subscribed' && m.queueId === b.queueId);

  await api('POST', `/v1/queues/${a.queueId}/messages`, { token: a.writeToken, body: { blob: 'depuis-a' } });
  await api('POST', `/v1/queues/${b.queueId}/messages`, { token: b.writeToken, body: { blob: 'depuis-b' } });

  assert.equal((await socket.attendre((m) => m.type === 'message' && m.queueId === a.queueId)).blob, 'depuis-a');
  assert.equal((await socket.attendre((m) => m.type === 'message' && m.queueId === b.queueId)).blob, 'depuis-b');
  socket.fermer();
});

test("une socket n'entend pas les boites des autres", options, async () => {
  const ecoutee = (await api('POST', '/v1/queues')).body;
  const autre = (await api('POST', '/v1/queues')).body;
  const socket = await openSocket();

  socket.envoyer({ type: 'subscribe', queueId: ecoutee.queueId, token: ecoutee.readToken });
  await socket.attendre((m) => m.type === 'subscribed');

  await api('POST', `/v1/queues/${autre.queueId}/messages`, { token: autre.writeToken, body: { blob: 'pas-pour-toi' } });
  await api('POST', `/v1/queues/${ecoutee.queueId}/messages`, { token: ecoutee.writeToken, body: { blob: 'pour-toi' } });

  // Le premier message recu doit etre celui de MA boite : si l'autre
  // arrivait aussi, il serait arrive avant.
  const recu = await socket.attendre((m) => m.type === 'message');
  assert.equal(recu.blob, 'pour-toi');
  socket.fermer();
});
