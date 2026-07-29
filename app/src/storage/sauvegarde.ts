// sauvegarde.ts — export et restauration chiffres par phrase secrete.
//
// LE PROBLEME QU'ON RESOUT
// ------------------------
// Jusqu'ici, telephone perdu = tout perdu : identite, contacts,
// conversations. Une messagerie sans compte n'a aucun serveur pour se
// souvenir a notre place — c'est precisement ce qu'on voulait, mais ca
// laisse l'utilisateur sans filet.
//
// CE QU'ON NE FAIT PAS
// --------------------
// Aucune sauvegarde automatique, aucun envoi vers un cloud. Les cles
// privees ne quittent pas l'appareil autrement que dans une archive que
// l'utilisateur produit LUI-MEME, protege par SA phrase, et range ou il
// veut. Une sauvegarde non chiffree n'existe pas dans ce fichier.
//
// LA CRYPTOGRAPHIE UTILISEE
// -------------------------
// Rien de maison : scrypt (derivation de cle depuis la phrase) et
// XChaCha20-Poly1305 (chiffrement authentifie), tous deux tires de
// @noble — les memes bibliotheques auditees que celles deja utilisees
// pour le code de verification mensuel.
//
// scrypt est LENT volontairement (~1 s sur telephone) : c'est ce qui
// rend une attaque par dictionnaire sur la phrase couteuse. Poly1305
// authentifie l'archive : un fichier modifie d'un seul octet est
// rejete, il ne se dechiffre pas « a moitie ».

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import type { SqlExecutor, SqlValue } from './sql';
import { migrate } from './sql';
import { randomBytes, toBase64, fromBase64, utf8Encode, utf8Decode } from '../platform/runtime';

/** Marqueur du format, pour refuser proprement un fichier etranger. */
export const FORMAT = 'blackout-sauvegarde';
export const VERSION_FORMAT = 1;

/** Cout scrypt. 2^15 tient en ~1 s sur telephone, et coute cher a attaquer. */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const LONGUEUR_CLE = 32;
const LONGUEUR_SEL = 16;
const LONGUEUR_NONCE = 24;

/** En dessous, une phrase ne protege rien contre un dictionnaire. */
export const LONGUEUR_PHRASE_MIN = 10;

/**
 * Tables sauvegardees, dans un ordre qui respecte les dependances.
 *
 * `locations` et `location_sharing` sont VOLONTAIREMENT absentes : une
 * position est valable quelques minutes, la restaurer n'aurait aucun
 * sens, et une archive qui traine ne doit pas contenir l'endroit ou se
 * trouvaient des amis le jour de l'export.
 */
export const TABLES_SAUVEGARDEES = [
  'identity',
  'contacts',
  'signed_prekeys',
  'kyber_prekeys',
  'one_time_prekeys',
  'conversations',
  'group_members',
  'messages',
  'queues',
  'inboxes',
  'settings',
] as const;

interface Archive {
  format: string;
  v: number;
  kdf: { n: number; r: number; p: number; sel: string };
  nonce: string;
  donnees: string;
}

interface Contenu {
  exporteLe: number;
  versionBase: number;
  tables: Record<string, Record<string, SqlValue>[]>;
}

function verifierPhrase(phrase: string): void {
  if (typeof phrase !== 'string' || phrase.length < LONGUEUR_PHRASE_MIN) {
    throw new Error(`la phrase secrete doit faire au moins ${LONGUEUR_PHRASE_MIN} caracteres`);
  }
}

function deriverCle(phrase: string, sel: Uint8Array): Uint8Array {
  return scrypt(utf8Encode(phrase), sel, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: LONGUEUR_CLE,
  });
}

/**
 * Produit une archive chiffree de tout ce qui compte.
 *
 * @returns du texte : a ecrire dans un fichier, a envoyer par le moyen
 *          que l'utilisateur juge sur. Sans la phrase, il est inerte.
 */
export async function exporterSauvegarde(db: SqlExecutor, phrase: string): Promise<string> {
  verifierPhrase(phrase);

  const { rows } = await db.execute('PRAGMA user_version');
  const tables: Record<string, Record<string, SqlValue>[]> = {};
  for (const table of TABLES_SAUVEGARDEES) {
    const res = await db.execute(`SELECT * FROM ${table}`);
    tables[table] = res.rows;
  }

  const contenu: Contenu = {
    exporteLe: Date.now(),
    versionBase: Number(rows[0]?.user_version ?? 0),
    tables,
  };

  const sel = randomBytes(LONGUEUR_SEL);
  const nonce = randomBytes(LONGUEUR_NONCE);
  const cle = deriverCle(phrase, sel);
  const chiffre = xchacha20poly1305(cle, nonce).encrypt(utf8Encode(JSON.stringify(contenu)));

  const archive: Archive = {
    format: FORMAT,
    v: VERSION_FORMAT,
    kdf: { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, sel: toBase64(sel) },
    nonce: toBase64(nonce),
    donnees: toBase64(chiffre),
  };
  return JSON.stringify(archive);
}

/** Ce qu'on peut dire d'une archive SANS connaitre la phrase. */
export function inspecterArchive(texte: string): { format: string; v: number } {
  let archive: Archive;
  try {
    archive = JSON.parse(texte);
  } catch {
    throw new Error("ce fichier n'est pas une sauvegarde Blackout");
  }
  if (archive?.format !== FORMAT) throw new Error("ce fichier n'est pas une sauvegarde Blackout");
  if (archive.v !== VERSION_FORMAT) {
    throw new Error(`sauvegarde en version ${archive.v}, cette app attend la version ${VERSION_FORMAT}`);
  }
  return { format: archive.format, v: archive.v };
}

/**
 * Restaure une archive. REMPLACE tout le contenu local.
 *
 * Refuse par defaut d'ecraser une installation deja en service :
 * restaurer par-dessus des conversations en cours ferait RECULER l'etat
 * des sessions, et les messages recus depuis deviendraient
 * indechiffrables. Il faut donc le demander explicitement.
 */
export async function importerSauvegarde(
  db: SqlExecutor,
  texte: string,
  phrase: string,
  options: { remplacer?: boolean } = {},
): Promise<{ tables: number; lignes: number }> {
  verifierPhrase(phrase);
  inspecterArchive(texte);
  const archive: Archive = JSON.parse(texte);

  if (!options.remplacer) {
    const { rows } = await db.execute('SELECT COUNT(*) AS n FROM identity');
    if (Number(rows[0]?.n ?? 0) > 0) {
      throw new Error(
        'une identite existe deja sur cet appareil : la restauration effacerait les conversations en cours',
      );
    }
  }

  const cle = deriverCle(phrase, fromBase64(archive.kdf.sel));
  let contenu: Contenu;
  try {
    const clair = xchacha20poly1305(cle, fromBase64(archive.nonce)).decrypt(fromBase64(archive.donnees));
    contenu = JSON.parse(utf8Decode(clair));
  } catch {
    // Poly1305 ne distingue pas « mauvaise phrase » de « fichier
    // abime » : dans les deux cas l'authentification echoue.
    throw new Error('phrase secrete incorrecte, ou sauvegarde alteree');
  }

  // La base doit exister avec le bon schema avant d'y reinjecter quoi
  // que ce soit : une restauration sur une app fraichement installee
  // arrive avant toute autre ecriture.
  await migrate(db);

  let lignes = 0;
  // Ordre inverse pour la suppression : on vide les tables filles avant
  // les tables parentes.
  for (const table of [...TABLES_SAUVEGARDEES].reverse()) {
    await db.execute(`DELETE FROM ${table}`);
  }
  for (const table of TABLES_SAUVEGARDEES) {
    for (const ligne of contenu.tables[table] ?? []) {
      const colonnes = Object.keys(ligne);
      if (colonnes.length === 0) continue;
      const trous = colonnes.map(() => '?').join(', ');
      await db.execute(
        `INSERT OR REPLACE INTO ${table} (${colonnes.join(', ')}) VALUES (${trous})`,
        colonnes.map((c) => ligne[c]),
      );
      lignes += 1;
    }
  }

  return { tables: TABLES_SAUVEGARDEES.length, lignes };
}
