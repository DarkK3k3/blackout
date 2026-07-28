// http.js — la couche HTTP du relais, en API Fetch standard.
//
// Meme API que le relais Node, au caractere pres. C'est volontaire et
// important : l'app installee sur les telephones continue de parler
// exactement le meme protocole. Migrer vers Cloudflare ne demande donc
// ni recompilation, ni reinstallation — juste une adresse a changer
// dans les reglages.
//
//   POST   /v1/queues                            -> {queueId, readToken, writeToken}
//   POST   /v1/queues/:id/messages   (Bearer writeToken, {blob})
//   GET    /v1/queues/:id/messages   (Bearer readToken)
//   DELETE /v1/queues/:id/messages/:msgId (Bearer readToken) = ack
//   DELETE /v1/queues/:id            (Bearer readToken)
//   POST   /v1/invites               ({blob}) -> {inviteId}
//   GET    /v1/invites/:id           -> {blob}
//   GET    /healthz
//
// Rien n'est journalise : ni IP, ni horodatage d'acces, ni identifiant.

export const MAX_BLOB_BYTES = 8 * 1024 * 1024; // photos chiffrees incluses
export const MAX_BODY_BYTES = Math.ceil(MAX_BLOB_BYTES * 1.4); // marge base64 + JSON

/**
 * @param {Request} request
 * @param {import('./store.js').RelayStore} store
 * @param {(queueId: string, message: {id: string, blob: string, postedAt: number}) => void} [onPosted]
 *        appele apres un depot reussi, pour pousser vers les abonnes WebSocket
 */
export async function handleRequest(request, store, onPosted) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = request.method;

  if (method === 'GET' && url.pathname === '/healthz') {
    return json(200, { ok: true });
  }

  if (parts[0] === 'v1' && parts[1] === 'invites') {
    if (method === 'POST' && parts.length === 2) {
      const body = await readJson(request);
      if (!body.ok) return json(body.reason === 'too_large' ? 413 : 400, { error: body.reason });
      const r = await store.putInvite(body.value.blob);
      if (r.status === 'too_large') return json(413, { error: 'too_large' });
      if (r.status !== 'ok') return json(400, { error: 'bad_request' });
      return json(201, { inviteId: r.inviteId });
    }
    if (method === 'GET' && parts.length === 3) {
      const r = await store.getInvite(parts[2]);
      if (r.status !== 'ok') return json(404, { error: 'not_found' });
      return json(200, { blob: r.blob });
    }
    return json(404, { error: 'not_found' });
  }

  if (parts[0] !== 'v1' || parts[1] !== 'queues') {
    return json(404, { error: 'not_found' });
  }

  if (method === 'POST' && parts.length === 2) {
    return json(201, await store.createQueue());
  }

  const queueId = parts[2];
  const token = bearerToken(request);
  if (!queueId || !token) return json(401, { error: 'missing_token' });

  if (method === 'POST' && parts.length === 4 && parts[3] === 'messages') {
    const body = await readJson(request);
    if (!body.ok) return json(body.reason === 'too_large' ? 413 : 400, { error: body.reason });
    const blob = body.value.blob;
    if (typeof blob !== 'string' || blob.length === 0) return json(400, { error: 'missing_blob' });
    if (blob.length > MAX_BODY_BYTES) return json(413, { error: 'too_large' });

    const r = await store.post(queueId, token, blob);
    if (r.status !== 'ok') return statusToResponse(r.status);
    onPosted?.(queueId, r.message);
    return json(201, { id: r.message.id });
  }

  if (method === 'GET' && parts.length === 4 && parts[3] === 'messages') {
    const r = await store.fetch(queueId, token);
    if (r.status !== 'ok') return statusToResponse(r.status);
    return json(200, { messages: r.messages });
  }

  if (method === 'DELETE' && parts.length === 5 && parts[3] === 'messages') {
    const r = await store.ack(queueId, token, parts[4]);
    if (r.status !== 'ok') return statusToResponse(r.status);
    return new Response(null, { status: 204 });
  }

  if (method === 'DELETE' && parts.length === 3) {
    const r = await store.deleteQueue(queueId, token);
    if (r.status !== 'ok') return statusToResponse(r.status);
    return new Response(null, { status: 204 });
  }

  return json(404, { error: 'not_found' });
}

function bearerToken(request) {
  const h = request.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Lit un corps JSON en distinguant les deux echecs possibles : trop
 * gros (413) et mal forme (400). Les confondre changerait les codes de
 * statut rendus par l'ancien relais.
 *
 * @returns {{ok: true, value: object} | {ok: false, reason: 'too_large'|'bad_json'}}
 */
async function readJson(request) {
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, reason: 'too_large' };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object') return { ok: false, reason: 'bad_json' };
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
}

export function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function statusToResponse(status) {
  if (status === 'not_found') return json(404, { error: 'not_found' });
  if (status === 'forbidden') return json(403, { error: 'forbidden' });
  if (status === 'full') return json(429, { error: 'queue_full' });
  return json(500, { error: 'internal' });
}
