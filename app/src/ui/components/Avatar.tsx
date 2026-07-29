// Avatar — le motif d'une cle d'identite, dessine.
//
// Le calcul vit dans avatarMath.ts, teste separement : ce fichier ne
// fait que le mettre en forme. Formes carrees et coins coupes, comme le
// reste de l'interface — aucun arrondi mou.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Polygon } from 'react-native-svg';
import { motifDepuisCle, COTE } from './avatarMath';
import { colors, type } from '../theme/tokens';

export function Avatar({
  cleIdentite,
  initiales,
  taille = 44,
  verifie = false,
}: {
  /** Cle publique d'identite du contact. Vide = contact pas encore connu. */
  cleIdentite: string;
  /** Repli affiche tant qu'aucune cle n'est connue. */
  initiales?: string;
  taille?: number;
  verifie?: boolean;
}) {
  const motif = React.useMemo(() => motifDepuisCle(cleIdentite), [cleIdentite]);
  const bordure = verifie ? colors.cyan : colors.warn;

  // Sans cle, inventer un motif serait un mensonge : on retombe sur les
  // initiales, qui n'affirment rien sur l'identite.
  if (!cleIdentite) {
    return (
      <View
        style={[styles.repli, { width: taille, height: taille, borderColor: bordure }]}
        accessibilityLabel="Contact sans cle connue"
      >
        <Text style={styles.repliTexte}>{initiales ?? '?'}</Text>
      </View>
    );
  }

  const pas = taille / COTE;

  return (
    <View
      style={[styles.boite, { width: taille, height: taille, borderColor: bordure }]}
      accessibilityLabel={`Empreinte visuelle ${motif.empreinteCourte}`}
    >
      <Svg width={taille} height={taille} viewBox={`0 0 ${taille} ${taille}`}>
        <Rect x={0} y={0} width={taille} height={taille} fill={colors.panelRaised} />
        {motif.cases.map((allumee, i) =>
          allumee ? (
            <Polygon
              key={i}
              // Losange plutot que carre : la meme geometrie anguleuse
              // que les pastilles de la carte et les badges d'etat.
              points={losange((i % COTE) * pas, Math.floor(i / COTE) * pas, pas)}
              fill={motif.couleur}
            />
          ) : null,
        )}
      </Svg>
    </View>
  );
}

/** Losange inscrit dans la case (x, y) de cote `pas`. */
function losange(x: number, y: number, pas: number): string {
  const m = pas / 2;
  return `${x + m},${y} ${x + pas},${y + m} ${x + m},${y + pas} ${x},${y + m}`;
}

const styles = StyleSheet.create({
  boite: { borderWidth: 2, overflow: 'hidden' },
  repli: {
    borderWidth: 2,
    backgroundColor: colors.panelRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repliTexte: { ...type.label, fontSize: 15, color: colors.text },
});
