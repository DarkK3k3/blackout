/**
 * @jest-environment node
 *
 * Test de fumee contre un relais REEL (le tien, par son URL publique).
 * Ignore par defaut ; activé en fournissant l'URL :
 *
 *   BLACKOUT_RELAY_URL=https://mon-relais.example.com npm run test:relay
 *
 * A relancer apres chaque changement d'hebergement (PC, tunnel,
 * Cloudflare Workers…) : s'il passe, l'app sait parler a ce relais.
 */

import { Blackout } from '../blackout';
import { nodeSignalBridge } from '../../crypto/testutils/nodeSignalBridge';
import { BlackoutStore } from '../../storage/store';
import { createNodeSqlExecutor } from '../../storage/testutils/nodeSqlExecutor';

const RELAY_URL = process.env.BLACKOUT_RELAY_URL;
const maybe = RELAY_URL ? describe : describe.skip;

async function makeApp(name: string) {
  const store = await BlackoutStore.open(createNodeSqlExecutor());
  const app = new Blackout(store, nodeSignalBridge, RELAY_URL!, name);
  await app.init();
  return { app, store };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('delai depasse — le relais ne repond pas comme attendu');
}

maybe('relais reel', () => {
  it('repond sur /healthz', async () => {
    const res = await fetch(`${RELAY_URL}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('porte une conversation complete de bout en bout', async () => {
    const bob = await makeApp('Bob');
    const alice = await makeApp('Alice');

    const invite = await bob.app.createInviteQr();
    const bobId = await alice.app.acceptInviteQr(invite.encoded);

    await bob.app.startListening(() => {});
    await waitFor(async () => (await bob.app.listChats()).length === 1);
    const aliceId = (await bob.app.listChats())[0].id;
    expect((await bob.app.listChats())[0].title).toBe('Alice');

    await alice.app.startListening(() => {});
    await alice.app.sendText(bobId, 'Test via le vrai relais');
    await waitFor(async () =>
      (await bob.app.listMessages(aliceId)).some((m) => m.body === 'Test via le vrai relais'),
    );

    await bob.app.sendText(aliceId, 'Bien recu !');
    await waitFor(async () =>
      (await alice.app.listMessages(bobId)).some((m) => m.body === 'Bien recu !'),
    );

    const vAlice = await alice.app.verificationFor(bobId);
    const vBob = await bob.app.verificationFor(aliceId);
    expect(vAlice.code).toBe(vBob.code);

    alice.app.stopListening();
    bob.app.stopListening();
  }, 60_000);
});
