// worker.js — la porte d'entree du relais.
//
// Le Worker ne fait que router : il ne garde rien, ne lit rien, et
// repond lui-meme au controle de sante pour eviter de reveiller le
// Durable Object (donc de consommer du quota) a chaque test d'adresse
// depuis l'ecran Reglages de l'app.

import { RelayRoom } from './relayRoom.js';

export { RelayRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!url.pathname.startsWith('/v1/')) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Un seul objet pour tout le relais : voir l'en-tete de relayRoom.js.
    const id = env.RELAY.idFromName('v1');
    return env.RELAY.get(id).fetch(request);
  },
};
