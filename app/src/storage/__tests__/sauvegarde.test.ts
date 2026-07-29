/**
 * @jest-environment node
 *
 * Une sauvegarde qui ne se restaure pas est pire qu'une absence de
 * sauvegarde : elle donne un faux sentiment de securite jusqu'au jour
 * ou on en a besoin. D'ou des tests sur le cycle complet, pas seulement
 * sur le chiffrement.
 */

import {
  exporterSauvegarde,
  importerSauvegarde,
  inspecterArchive,
  FORMAT,
  LONGUEUR_PHRASE_MIN,
  TABLES_SAUVEGARDEES,
} from '../sauvegarde';
import { BlackoutStore } from '../store';
import { createNodeSqlExecutor } from '../testutils/nodeSqlExecutor';
import { migrate } from '../sql';

const PHRASE = 'ma-phrase-secrete-2026';

/** Une base peuplee comme apres quelques jours d'usage. */
async function baseGarnie() {
  const db = createNodeSqlExecutor();
  const store = await BlackoutStore.open(db);
  await store.saveIdentity({
    identityRecord: 'record-prive-b64',
    publicKey: 'cle-publique-b64',
    registrationId: 4242,
    localAddress: 'adresse-locale-uuid',
  });
  await store.addContact({ id: 'bob', displayName: 'Bob', identityKey: 'cle-de-bob' });
  await store.addContact({ id: 'alice', displayName: 'Alice', identityKey: 'cle-d-alice' });
  await store.saveMessage({
    id: 'm1',
    conversationId: 'bob',
    senderContactId: null,
    kind: 'text',
    body: 'On se retrouve ou ce soir ?',
    sentAt: 1_700_000_000_000,
    status: 'sent',
  });
  await store.saveQueues('bob', {
    serverUrl: 'https://relais.example',
    inQueueId: 'q-in',
    inReadToken: 'jeton-lecture',
    outQueueId: 'q-out',
    outWriteToken: 'jeton-ecriture',
  });
  return { db, store };
}

describe('cycle complet', () => {
  it('restaure a l identique sur un appareil vierge', async () => {
    const source = await baseGarnie();
    const archive = await exporterSauvegarde(source.db, PHRASE);

    // Nouveau telephone : base vide, schema applique.
    const cible = createNodeSqlExecutor();
    await migrate(cible);
    const bilan = await importerSauvegarde(cible, archive, PHRASE);

    expect(bilan.tables).toBe(TABLES_SAUVEGARDEES.length);
    expect(bilan.lignes).toBeGreaterThan(0);

    const restaure = await BlackoutStore.open(cible);
    const identite = await restaure.getIdentity();
    expect(identite?.publicKey).toBe('cle-publique-b64');
    expect(identite?.localAddress).toBe('adresse-locale-uuid');
    expect(identite?.registrationId).toBe(4242);

    const contacts = await restaure.listContacts();
    expect(contacts.map((c) => c.id).sort()).toEqual(['alice', 'bob']);

    const messages = await restaure.listMessages('bob');
    expect(messages.map((m) => m.body)).toEqual(['On se retrouve ou ce soir ?']);

    const queues = await restaure.getQueues('bob');
    expect(queues?.outWriteToken).toBe('jeton-ecriture');
  });

  it("conserve l'identite, donc les conversations en cours ne sont pas cassees", async () => {
    // Restaurer avec une NOUVELLE identite obligerait a refaire tous
    // les contacts : c'est justement ce qu'on veut eviter.
    const source = await baseGarnie();
    const avant = await (await BlackoutStore.open(source.db)).getIdentity();
    const archive = await exporterSauvegarde(source.db, PHRASE);

    const cible = createNodeSqlExecutor();
    await migrate(cible);
    await importerSauvegarde(cible, archive, PHRASE);

    const apres = await (await BlackoutStore.open(cible)).getIdentity();
    expect(apres).toEqual(avant);
  });
});

describe('protection par la phrase', () => {
  it('refuse une phrase erronee', async () => {
    const source = await baseGarnie();
    const archive = await exporterSauvegarde(source.db, PHRASE);
    const cible = createNodeSqlExecutor();
    await migrate(cible);

    await expect(importerSauvegarde(cible, archive, 'mauvaise-phrase-longue')).rejects.toThrow(
      /incorrecte|alteree/,
    );
    // ... et rien n'a ete ecrit au passage.
    const { rows } = await cible.execute('SELECT COUNT(*) AS n FROM contacts');
    expect(Number(rows[0].n)).toBe(0);
  });

  it('refuse une archive modifiee, meme d un seul octet', async () => {
    // Poly1305 authentifie : une archive trafiquee ne doit pas se
    // dechiffrer « a moitie ».
    const source = await baseGarnie();
    const archive = JSON.parse(await exporterSauvegarde(source.db, PHRASE));
    const octets = Buffer.from(archive.donnees, 'base64');
    octets[10] ^= 0x01;
    archive.donnees = octets.toString('base64');

    const cible = createNodeSqlExecutor();
    await migrate(cible);
    await expect(importerSauvegarde(cible, JSON.stringify(archive), PHRASE)).rejects.toThrow(
      /incorrecte|alteree/,
    );
  });

  it('refuse une phrase trop courte, a l export comme a l import', async () => {
    const source = await baseGarnie();
    await expect(exporterSauvegarde(source.db, 'court')).rejects.toThrow(
      new RegExp(String(LONGUEUR_PHRASE_MIN)),
    );
    const archive = await exporterSauvegarde(source.db, PHRASE);
    const cible = createNodeSqlExecutor();
    await migrate(cible);
    await expect(importerSauvegarde(cible, archive, 'court')).rejects.toThrow();
  });

  it('produit une archive differente a chaque export, avec la meme phrase', async () => {
    // Sel et nonce aleatoires : deux archives identiques revèleraient
    // que le contenu n'a pas change.
    const source = await baseGarnie();
    const a = JSON.parse(await exporterSauvegarde(source.db, PHRASE));
    const b = JSON.parse(await exporterSauvegarde(source.db, PHRASE));
    expect(a.kdf.sel).not.toBe(b.kdf.sel);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.donnees).not.toBe(b.donnees);
  });
});

describe('ce que l archive laisse voir', () => {
  it('ne laisse fuiter aucun contenu en clair', async () => {
    const source = await baseGarnie();
    const archive = await exporterSauvegarde(source.db, PHRASE);
    expect(archive).not.toContain('On se retrouve');
    expect(archive).not.toContain('Bob');
    expect(archive).not.toContain('record-prive-b64');
    expect(archive).not.toContain('jeton-ecriture');
    expect(archive).not.toContain(PHRASE);
  });

  it("n'emporte aucune position", async () => {
    // Une archive qui traine ne doit pas dire ou se trouvaient des amis.
    expect(TABLES_SAUVEGARDEES).not.toContain('locations');
    expect(TABLES_SAUVEGARDEES).not.toContain('location_sharing');
  });

  it('annonce son format sans reveler quoi que ce soit', async () => {
    const source = await baseGarnie();
    const archive = await exporterSauvegarde(source.db, PHRASE);
    expect(inspecterArchive(archive)).toEqual({ format: FORMAT, v: 1 });
  });
});

describe('garde-fous', () => {
  it("refuse d'ecraser une installation en service sans confirmation", async () => {
    // Restaurer par-dessus des conversations en cours ferait RECULER
    // l'etat des sessions : les messages recus depuis deviendraient
    // indechiffrables.
    const source = await baseGarnie();
    const archive = await exporterSauvegarde(source.db, PHRASE);
    const occupee = await baseGarnie();

    await expect(importerSauvegarde(occupee.db, archive, PHRASE)).rejects.toThrow(/identite existe deja/);
    await expect(
      importerSauvegarde(occupee.db, archive, PHRASE, { remplacer: true }),
    ).resolves.toMatchObject({ lignes: expect.any(Number) });
  });

  it('rejette un fichier qui n est pas une sauvegarde', async () => {
    const cible = createNodeSqlExecutor();
    await migrate(cible);
    await expect(importerSauvegarde(cible, 'pas du json', PHRASE)).rejects.toThrow(/pas une sauvegarde/);
    await expect(importerSauvegarde(cible, '{"format":"autre-app"}', PHRASE)).rejects.toThrow(
      /pas une sauvegarde/,
    );
  });

  it('rejette une sauvegarde produite par une version future', async () => {
    const source = await baseGarnie();
    const archive = JSON.parse(await exporterSauvegarde(source.db, PHRASE));
    archive.v = 99;
    const cible = createNodeSqlExecutor();
    await migrate(cible);
    await expect(importerSauvegarde(cible, JSON.stringify(archive), PHRASE)).rejects.toThrow(/version 99/);
  });

  it('remplace le contenu au lieu de le cumuler', async () => {
    // Restaurer deux fois de suite ne doit pas dupliquer les messages.
    const source = await baseGarnie();
    const archive = await exporterSauvegarde(source.db, PHRASE);
    const cible = createNodeSqlExecutor();
    await migrate(cible);

    await importerSauvegarde(cible, archive, PHRASE);
    await importerSauvegarde(cible, archive, PHRASE, { remplacer: true });

    const store = await BlackoutStore.open(cible);
    expect(await store.listMessages('bob')).toHaveLength(1);
    expect(await store.listContacts()).toHaveLength(2);
  });
});
