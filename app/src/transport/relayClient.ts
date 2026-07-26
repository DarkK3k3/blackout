// relayClient.ts
// ------------------------------------------------------------------
// Client du serveur relais (relay-server/), utilisable tel quel sous
// React Native ET sous Node : uniquement fetch + WebSocket globaux.
//
// Le relais ne voit que des blobs opaques : tout ce qui passe ici est
// DEJA chiffre par la couche session. Ce client ne connait ni les
// cles, ni le contenu — que des identifiants de queues et des tokens.
// ------------------------------------------------------------------

export interface QueueCredentials {
  queueId: string;
  readToken: string;
  writeToken: string;
}

export interface RelayMessage {
  queueId: string;
  id: string;
  blob: string;
  postedAt: number;
}

export class RelayClient {
  constructor(private serverUrl: string) {}

  private get wsUrl(): string {
    return this.serverUrl.replace(/^http/, 'ws') + '/v1/ws';
  }

  /** Cree une boite aux lettres (cote destinataire). */
  async createQueue(): Promise<QueueCredentials> {
    const res = await fetch(`${this.serverUrl}/v1/queues`, { method: 'POST' });
    if (res.status !== 201) throw new Error(`createQueue: HTTP ${res.status}`);
    return res.json();
  }

  /** Depose un blob chiffre dans la boite d'un contact. */
  async post(queueId: string, writeToken: string, blob: string): Promise<string> {
    const res = await fetch(`${this.serverUrl}/v1/queues/${queueId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${writeToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ blob }),
    });
    if (res.status !== 201) throw new Error(`post: HTTP ${res.status}`);
    return (await res.json()).id;
  }

  /** Releve ponctuelle (fallback sans WebSocket). */
  async fetchMessages(queueId: string, readToken: string): Promise<RelayMessage[]> {
    const res = await fetch(`${this.serverUrl}/v1/queues/${queueId}/messages`, {
      headers: { authorization: `Bearer ${readToken}` },
    });
    if (res.status !== 200) throw new Error(`fetchMessages: HTTP ${res.status}`);
    const { messages } = await res.json();
    return messages.map((m: { id: string; blob: string; postedAt: number }) => ({ queueId, ...m }));
  }

  /**
   * Depose le contenu PUBLIC d'une invitation (trop volumineux pour un
   * QR code) et retourne sa reference. Le scanneur verifiera l'empreinte :
   * le relais ne peut donc pas substituer un autre bundle.
   */
  async putInvite(blob: string): Promise<string> {
    const res = await fetch(`${this.serverUrl}/v1/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob }),
    });
    if (res.status !== 201) throw new Error(`putInvite: HTTP ${res.status}`);
    return (await res.json()).inviteId;
  }

  /** Recupere une invitation deposee. Le contenu DOIT etre verifie ensuite. */
  static async getInvite(serverUrl: string, inviteId: string): Promise<string> {
    const res = await fetch(`${serverUrl}/v1/invites/${inviteId}`);
    if (res.status === 404) throw new Error('invitation introuvable ou expiree');
    if (!res.ok) throw new Error(`getInvite: HTTP ${res.status}`);
    return (await res.json()).blob;
  }

  /** Ack : suppression definitive cote serveur apres persistance locale. */
  async ack(queueId: string, readToken: string, messageId: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/v1/queues/${queueId}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${readToken}` },
    });
    if (res.status !== 204) throw new Error(`ack: HTTP ${res.status}`);
  }

  async deleteQueue(queueId: string, readToken: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/v1/queues/${queueId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${readToken}` },
    });
    if (res.status !== 204) throw new Error(`deleteQueue: HTTP ${res.status}`);
  }

  /**
   * Abonnement temps reel a plusieurs boites. Livre le backlog puis
   * chaque nouveau message ; l'appelant DOIT appeler `ack()` apres
   * avoir persiste le message (sinon il sera relivre — livraison
   * "au moins une fois", la deduplication se fait par id de message).
   * Reconnexion automatique avec backoff. Retourne une fonction stop.
   */
  subscribe(
    queues: { queueId: string; readToken: string }[],
    onMessage: (message: RelayMessage, ack: () => Promise<void>) => void,
    onStatus?: (status: 'connected' | 'disconnected') => void,
  ): () => void {
    let ws: WebSocket | null = null;
    let stopped = false;
    let backoffMs = 500;

    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(this.wsUrl);

      ws.onopen = () => {
        backoffMs = 500;
        onStatus?.('connected');
        for (const q of queues) {
          ws!.send(JSON.stringify({ type: 'subscribe', queueId: q.queueId, token: q.readToken }));
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        let msg: { type: string; queueId: string; id: string; blob: string; postedAt: number };
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type !== 'message') return;
        const q = queues.find((x) => x.queueId === msg.queueId);
        if (!q) return;
        onMessage(
          { queueId: msg.queueId, id: msg.id, blob: msg.blob, postedAt: msg.postedAt },
          () => this.ack(msg.queueId, q.readToken, msg.id),
        );
      };

      ws.onclose = () => {
        onStatus?.('disconnected');
        if (!stopped) {
          setTimeout(connect, backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      };
      ws.onerror = () => {
        // onclose suivra et gerera la reconnexion
      };
    };

    connect();
    return () => {
      stopped = true;
      ws?.close();
    };
  }
}
