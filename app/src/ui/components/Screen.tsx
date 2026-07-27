// Screen — conteneur qui respecte les zones de securite de l'appareil.
//
// Les marges etaient jusqu'ici ecrites en dur (24 points en haut). Sur
// un iPhone a Dynamic Island, la zone reservee fait une soixantaine de
// points : le titre de l'app passait dessous. Le meme probleme existe
// en bas avec la barre d'accueil.
//
// `useSafeAreaInsets` donne les vraies valeurs de l'appareil courant,
// donc ca marche aussi bien sur un iPhone SE que sur un modele a
// encoche ou a Dynamic Island.

import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '../theme/tokens';

export interface ScreenProps {
  children: React.ReactNode;
  /** Applique la marge haute. A desactiver si un en-tete de navigation la gere deja. */
  top?: boolean;
  /** Applique la marge basse (barre d'accueil). */
  bottom?: boolean;
  style?: ViewStyle | ViewStyle[];
}

export function Screen({ children, top = true, bottom = true, style }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        {
          // Un petit espace est ajoute a la zone systeme : coller un
          // titre juste sous la Dynamic Island reste desagreable.
          paddingTop: top ? insets.top + space.sm : 0,
          paddingBottom: bottom ? Math.max(insets.bottom, space.sm) : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Marges de securite brutes, pour les ecrans qui les appliquent eux-memes. */
export function useSafeInsets() {
  return useSafeAreaInsets();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
});
