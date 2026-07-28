// relayRoom.js — le Durable Object qui heberge les boites aux lettres.
//
// UN SEUL objet pour tout le relais. Ce choix merite d'etre justifie :
// Cloudflare permettrait un objet par queue, mais l'app ouvre UNE seule
// WebSocket sur laquelle elle s'abonne a toutes ses boites — et une
// socket ne peut etre rattachee qu'a un objet. Decouper imposerait donc
// une dizaine de connexions par telephone, et une refonte du client.
// A l'echelle d'un groupe d'amis, un objet unique est largement
// suffisant, et le code reste lisible, donc auditable.
//
// Rien n'est perdu cote confidentialite : les blobs restent chiffres de
// bout en bout, les tokens ne sont stockes que haches, et deux boites
// qui appartiennent a la meme conversation ne portent aucun lien entre
// elles. Le relais voit passer des octets opaques dans des boites
// numerotees, comme avant.
//
// Les WebSockets utilisent l'API d'HIBERNATION : quand plus rien ne
// circule, Cloudflare peut evacuer l'objet de la memoire SANS couper
// les connexions. C'est ce qui rend le service viable sur le plan
// gratuit — un relais qui ne dort jamais consommerait le quota en
// quelques heures. Consequence a ne pas oublier : toute variable
// d'instance disparait au reveil. L'etat d'abonnement d'une socket est
// donc range DANS la socket (serializeAttachment), pas dans une Map.

import { DurableObject } from 'cloudflare:workers';
import { RelayStore } from './store.js';
import { handleRequest, json } from './http.js';

const PURGE_INTERVAL_MS = 60 * 60 * 1000; // une passe de nettoyage par heure

export class RelayRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new RelayStore(ctx.storage.sql);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this._acceptSocket();
    }
    const response = await handleRequest(request, this.store, (queueId, message) =>
      this._pushToSubscribers(queueId, message),
    );
    await this._ensurePurgeScheduled();
    return response;
  }

  _acceptSocket() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    // Aucun abonnement tant que le client n'a pas prouve qu'il detient
    // un readToken : une socket ouverte ne donne acces a rien.
    server.serializeAttachment({ subs: [] });
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- WebSocket : meme protocole que le relais Node ---

  async webSocketMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return ws.send(JSON.stringify({ type: 'error', error: 'bad_json' }));
    }

    if (msg.type === 'subscribe') {
      const { queueId, token } = msg;
      if (typeof queueId !== 'string' || typeof token !== 'string' || !(await this.store.canRead(queueId, token))) {
        return ws.send(JSON.stringify({ type: 'error', error: 'forbidden', queueId }));
      }
      const state = ws.deserializeAttachment() ?? { subs: [] };
      if (!state.subs.includes(queueId)) state.subs.push(queueId);
      ws.serializeAttachment(state);
      ws.send(JSON.stringify({ type: 'subscribed', queueId }));

      // Backlog : tout ce qui attendait pendant que l'appareil etait hors ligne.
      const { messages } = await this.store.fetch(queueId, token);
      for (const m of messages) {
        ws.send(JSON.stringify({ type: 'message', queueId, id: m.id, blob: m.blob, postedAt: m.postedAt }));
      }
      return undefined;
    }

    if (msg.type === 'ack') {
      const { queueId, token, id } = msg;
      if (typeof queueId !== 'string' || typeof token !== 'string') return undefined;
      const r = await this.store.ack(queueId, token, id);
      return ws.send(JSON.stringify({ type: 'acked', queueId, id, ok: r.status === 'ok' }));
    }

    return ws.send(JSON.stringify({ type: 'unknown_type', error: 'unknown_type' }));
  }

  async webSocketClose(ws, code, reason) {
    // 1005 = "pas de code de statut recu". Le renvoyer tel quel fait
    // echouer close(), il faut donc le taire.
    ws.close(code === 1005 ? 1000 : code, reason);
  }

  _pushToSubscribers(queueId, message) {
    const payload = JSON.stringify({
      type: 'message',
      queueId,
      id: message.id,
      blob: message.blob,
      postedAt: message.postedAt,
    });
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment();
      if (state?.subs?.includes(queueId)) {
        try {
          ws.send(payload);
        } catch {
          // Socket en train de mourir : le message reste en boite et
          // sera reclame au prochain abonnement. Rien a signaler.
        }
      }
    }
  }

  // --- expiration ---

  async _ensurePurgeScheduled() {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + PURGE_INTERVAL_MS);
    }
  }

  async alarm() {
    this.store.purgeExpired();
    await this.ctx.storage.setAlarm(Date.now() + PURGE_INTERVAL_MS);
  }
}

export { json };
