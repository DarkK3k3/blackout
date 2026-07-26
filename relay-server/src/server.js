// server.js
// ------------------------------------------------------------------
// Serveur relais Blackout : HTTP (creation de queue, depot, releve,
// ack) + WebSocket (push temps reel vers le destinataire connecte).
//
// Ce que ce serveur NE fait volontairement PAS :
//  - aucun compte, aucun identifiant utilisateur, aucun annuaire
//  - aucun log d'IP ni d'acces (seulement les erreurs internes)
//  - aucune lecture du contenu : les blobs sont chiffres E2E par
//    l'app AVANT d'arriver ici, ce sont des octets opaques
//
// API :
//   POST   /v1/queues                          -> {queueId, readToken, writeToken}
//   POST   /v1/queues/:id/messages   (Bearer writeToken, {blob})
//   GET    /v1/queues/:id/messages   (Bearer readToken)
//   DELETE /v1/queues/:id/messages/:msgId (Bearer readToken)  = ack
//   DELETE /v1/queues/:id            (Bearer readToken)
//   GET    /healthz
//   WS     /v1/ws  puis {type:"subscribe", queueId, token} sur la socket
//          (le token passe dans un message WS, jamais dans l'URL)
// ------------------------------------------------------------------

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { QueueStore, InviteStore } from './store.js';

const MAX_BLOB_BYTES = 8 * 1024 * 1024; // photos chiffrees incluses
const MAX_BODY_BYTES = Math.ceil(MAX_BLOB_BYTES * 1.4); // marge base64+JSON

export function createRelayServer(opts = {}) {
  const store = opts.store ?? new QueueStore(opts);
  const invites = opts.invites ?? new InviteStore(opts);

  /** Abonnes WS par queueId (plusieurs appareils possibles a terme). */
  const subscribers = new Map(); // queueId -> Set<WebSocket>

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('erreur interne:', err.message);
      sendJson(res, 500, { error: 'internal' });
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/v1/ws' });

  wss.on('connection', (ws) => {
    /** Queues auxquelles CETTE socket est abonnee (auth deja verifiee). */
    const mySubscriptions = new Set();

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return ws.send(JSON.stringify({ type: 'error', error: 'bad_json' }));
      }

      if (msg.type === 'subscribe') {
        const { queueId, token } = msg;
        if (typeof queueId !== 'string' || typeof token !== 'string' || !store.canRead(queueId, token)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'forbidden', queueId }));
        }
        mySubscriptions.add(queueId);
        if (!subscribers.has(queueId)) subscribers.set(queueId, new Set());
        subscribers.get(queueId).add(ws);
        ws.send(JSON.stringify({ type: 'subscribed', queueId }));
        // Backlog : tout ce qui attendait pendant que l'appareil etait hors-ligne
        const { messages } = store.fetch(queueId, token);
        for (const m of messages) {
          ws.send(JSON.stringify({ type: 'message', queueId, id: m.id, blob: m.blob, postedAt: m.postedAt }));
        }
      } else if (msg.type === 'ack') {
        const { queueId, token, id } = msg;
        if (typeof queueId !== 'string' || typeof token !== 'string') return;
        const r = store.ack(queueId, token, id);
        ws.send(JSON.stringify({ type: 'acked', queueId, id, ok: r.status === 'ok' }));
      } else {
        ws.send(JSON.stringify({ type: 'error', error: 'unknown_type' }));
      }
    });

    ws.on('close', () => {
      for (const queueId of mySubscriptions) {
        subscribers.get(queueId)?.delete(ws);
        if (subscribers.get(queueId)?.size === 0) subscribers.delete(queueId);
      }
    });
  });

  function pushToSubscribers(queueId, message) {
    for (const ws of subscribers.get(queueId) ?? []) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'message', queueId, id: message.id, blob: message.blob, postedAt: message.postedAt }));
      }
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://relay.invalid');
    const parts = url.pathname.split('/').filter(Boolean); // ex: ["v1","queues",id,"messages"]

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true });
    }

    // --- invitations : contenu PUBLIC, verifie par empreinte cote client ---
    if (parts[0] === 'v1' && parts[1] === 'invites') {
      if (req.method === 'POST' && parts.length === 2) {
        const body = await readBody(req, MAX_BODY_BYTES);
        if (body === null) return sendJson(res, 413, { error: 'too_large' });
        let blob;
        try {
          blob = JSON.parse(body).blob;
        } catch {
          return sendJson(res, 400, { error: 'bad_json' });
        }
        const r = invites.put(blob);
        if (r.status === 'too_large') return sendJson(res, 413, { error: 'too_large' });
        if (r.status !== 'ok') return sendJson(res, 400, { error: 'bad_request' });
        return sendJson(res, 201, { inviteId: r.inviteId });
      }
      if (req.method === 'GET' && parts.length === 3) {
        const r = invites.get(parts[2]);
        if (r.status !== 'ok') return sendJson(res, 404, { error: 'not_found' });
        return sendJson(res, 200, { blob: r.blob });
      }
      return sendJson(res, 404, { error: 'not_found' });
    }

    if (parts[0] !== 'v1' || parts[1] !== 'queues') {
      return sendJson(res, 404, { error: 'not_found' });
    }

    // POST /v1/queues
    if (req.method === 'POST' && parts.length === 2) {
      return sendJson(res, 201, store.createQueue());
    }

    const queueId = parts[2];
    const token = bearerToken(req);
    if (!queueId || !token) return sendJson(res, 401, { error: 'missing_token' });

    // POST /v1/queues/:id/messages
    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'messages') {
      const body = await readBody(req, MAX_BODY_BYTES);
      if (body === null) return sendJson(res, 413, { error: 'too_large' });
      let blob;
      try {
        blob = JSON.parse(body).blob;
      } catch {
        return sendJson(res, 400, { error: 'bad_json' });
      }
      if (typeof blob !== 'string' || blob.length === 0) return sendJson(res, 400, { error: 'missing_blob' });
      if (Buffer.byteLength(blob, 'utf8') > MAX_BODY_BYTES) return sendJson(res, 413, { error: 'too_large' });

      const r = store.post(queueId, token, blob);
      if (r.status !== 'ok') return sendError(res, r.status);
      pushToSubscribers(queueId, r.message);
      return sendJson(res, 201, { id: r.message.id });
    }

    // GET /v1/queues/:id/messages
    if (req.method === 'GET' && parts.length === 4 && parts[3] === 'messages') {
      const r = store.fetch(queueId, token);
      if (r.status !== 'ok') return sendError(res, r.status);
      return sendJson(res, 200, { messages: r.messages });
    }

    // DELETE /v1/queues/:id/messages/:msgId  (ack)
    if (req.method === 'DELETE' && parts.length === 5 && parts[3] === 'messages') {
      const r = store.ack(queueId, token, parts[4]);
      if (r.status !== 'ok') return sendError(res, r.status);
      res.writeHead(204).end();
      return;
    }

    // DELETE /v1/queues/:id
    if (req.method === 'DELETE' && parts.length === 3) {
      const r = store.deleteQueue(queueId, token);
      if (r.status !== 'ok') return sendError(res, r.status);
      res.writeHead(204).end();
      return;
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  // Purge periodique des messages expires (TTL)
  const purgeTimer = setInterval(() => store.purgeAllExpired(), 60 * 60 * 1000);
  purgeTimer.unref();

  return {
    store,
    listen: (port = 0, host = '0.0.0.0') =>
      new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer.address()))),
    close: () =>
      new Promise((resolve) => {
        clearInterval(purgeTimer);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => httpServer.close(() => {
          store.saveNow();
          resolve();
        }));
      }),
  };
}

// --- utilitaires HTTP ---

function bearerToken(req) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        resolve(null); // trop gros
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, status) {
  if (status === 'not_found') return sendJson(res, 404, { error: 'not_found' });
  if (status === 'forbidden') return sendJson(res, 403, { error: 'forbidden' });
  if (status === 'full') return sendJson(res, 429, { error: 'queue_full' });
  return sendJson(res, 500, { error: 'internal' });
}

// Lancement direct : `node src/server.js` (PORT et DATA_FILE en env)
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  const dataFile = process.env.DATA_FILE || null; // '' ou absent = pas de persistance
  const relay = createRelayServer({ dataFile });
  relay.listen(port).then((addr) => {
    console.log(`relais blackout en ecoute sur :${addr.port} (persistance: ${dataFile})`);
  });
}
