// sauvegardeFichier.ts — sortir l'archive du telephone, et la reprendre.
//
// Une sauvegarde qu'on ne peut pas extraire de l'appareil n'est pas une
// sauvegarde : elle disparait avec lui. Ce fichier fait le pont entre
// l'archive chiffree (storage/sauvegarde.ts) et le systeme de fichiers.
//
// Ce qui sort d'ici est INERTE sans la phrase secrete : on peut le
// ranger dans un cloud, se l'envoyer par mail, le mettre sur une cle.
// C'est tout l'interet d'avoir chiffre avant d'ecrire.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

/** Extension propre a l'app : un fichier qu'on reconnait d'un coup d'oeil. */
const EXTENSION = 'blackout';

function nomDuJour(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `blackout-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${EXTENSION}`;
}

/**
 * Ecrit l'archive puis ouvre le partage systeme.
 *
 * Le fichier est ecrit dans le CACHE, pas dans les documents : une
 * archive oubliee sur l'appareil est une copie de plus a proteger. Le
 * systeme peut donc la reprendre quand il manque de place, une fois
 * qu'elle a ete rangee ailleurs.
 */
export async function partagerArchive(archive: string): Promise<{ partage: boolean; chemin: string }> {
  const fichier = new File(Paths.cache, nomDuJour());
  if (fichier.exists) fichier.delete();
  fichier.create();
  fichier.write(archive);

  if (!(await Sharing.isAvailableAsync())) {
    return { partage: false, chemin: fichier.uri };
  }
  await Sharing.shareAsync(fichier.uri, {
    dialogTitle: 'Sauvegarde Blackout (chiffree)',
    mimeType: 'application/octet-stream',
  });
  return { partage: true, chemin: fichier.uri };
}

/**
 * Demande un fichier a l'utilisateur et rend son contenu.
 * `null` s'il annule.
 */
export async function choisirArchive(): Promise<string | null> {
  const choix = await DocumentPicker.getDocumentAsync({
    // Pas de filtre par type : iOS ne connait pas notre extension, et
    // un filtre trop strict rendrait le fichier inselectionnable.
    type: '*/*',
    copyToCacheDirectory: true,
  });
  if (choix.canceled || !choix.assets?.[0]) return null;
  return new File(choix.assets[0].uri).text();
}
