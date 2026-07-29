// BootScreen — la seconde et demie qui donne le ton.
//
// Un ecran de chargement ne doit pas mentir : celui-ci affiche de VRAIS
// etats (base chiffree ouverte, identite chargee, relais joignable),
// pas une barre de progression decorative. Quand quelque chose echoue,
// il le montre au lieu de tourner dans le vide.
//
// Noir et gris, un seul accent : le trio neon est reserve aux
// indicateurs de securite, pas au decor. Les tetes de mort sont
// dessinees en caracteres, comme une sortie de terminal.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GlitchText, Scanlines } from '../components/Glitch';
import { colors, space, type, fonts } from '../theme/tokens';

/** Tete de mort en caracteres — sortie de terminal, pas illustration. */
const CRANE = [
  '  ▄███████▄  ',
  ' ███▀▀▀▀▀███ ',
  '██  ▄█ █▄  ██',
  '██  ▀▀ ▀▀  ██',
  ' ███▄ ▄▄ ▄███',
  '  ▀██ ██ ██▀ ',
  '   ▀▀▀▀▀▀▀▀  ',
];

export interface EtapeBoot {
  libelle: string;
  etat: 'attente' | 'ok' | 'echec';
}

export interface BootScreenProps {
  etapes: EtapeBoot[];
  /** Message d'echec bloquant, s'il y en a un. */
  erreur?: string | null;
}

const MARQUE: Record<EtapeBoot['etat'], string> = {
  attente: '···',
  ok: 'OK',
  echec: 'ECHEC',
};

export function BootScreen({ etapes, erreur = null }: BootScreenProps) {
  return (
    <View style={styles.root}>
      <Scanlines opacity={0.06} count={200} />

      <View style={styles.crane} accessibilityLabel="Blackout">
        {CRANE.map((ligne, i) => (
          <Text key={i} style={styles.craneLigne}>
            {ligne}
          </Text>
        ))}
      </View>

      <GlitchText text="BLACKOUT" duration={520} style={styles.titre} />
      <Text style={styles.sousTitre}>CHIFFRE DE BOUT EN BOUT · AUCUN COMPTE</Text>

      <View style={styles.journal}>
        {etapes.map((etape) => (
          <View key={etape.libelle} style={styles.ligneJournal}>
            <Text style={styles.libelle} numberOfLines={1}>
              {etape.libelle}
            </Text>
            <Text
              style={[
                styles.marque,
                etape.etat === 'ok' && { color: colors.cyan },
                etape.etat === 'echec' && { color: colors.danger },
              ]}
            >
              {MARQUE[etape.etat]}
            </Text>
          </View>
        ))}
      </View>

      {erreur ? (
        <View style={styles.erreurBoite}>
          <Text style={styles.erreurTitre}>DEMARRAGE IMPOSSIBLE</Text>
          <Text style={styles.erreurCorps}>{erreur}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.void,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  crane: { alignItems: 'center' },
  craneLigne: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 15,
    color: colors.textDim,
    letterSpacing: 1,
  },
  titre: { ...type.hero, color: colors.text, marginTop: space.md },
  sousTitre: { ...type.dataSmall, color: colors.textFaint, textAlign: 'center' },
  journal: {
    marginTop: space.xl,
    width: '100%',
    maxWidth: 320,
    gap: space.xs,
  },
  ligneJournal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  libelle: { ...type.dataSmall, color: colors.textDim, flexShrink: 1 },
  marque: { ...type.dataSmall, color: colors.textFaint },
  erreurBoite: {
    marginTop: space.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    paddingLeft: space.md,
    gap: space.xs,
  },
  erreurTitre: { ...type.label, color: colors.danger },
  erreurCorps: { ...type.meta, color: colors.textDim, textAlign: 'left' },
});
