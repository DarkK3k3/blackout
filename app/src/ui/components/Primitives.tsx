// Primitives — boutons, badges d'etat, pictogrammes anguleux.
// Tout est a angles francs : pas d'arrondi mou, formes geometriques.

import React from 'react';
import { Text, View, StyleSheet, type ViewStyle } from 'react-native';
import Svg, { Path, Polygon, Circle, Line } from 'react-native-svg';
import { CutFrame } from './CutFrame';
import { PressionVivante } from './Vivant';
import type { Retour } from '../retour';
import { colors, space, type } from '../theme/tokens';

// ---------------------------------------------------------------- bouton

export function ActionButton({
  label,
  onPress,
  accent = colors.ember,
  disabled = false,
  retour = 'toucher',
  style,
}: {
  label: string;
  onPress: () => void;
  accent?: string;
  disabled?: boolean;
  /** Retour tactile associe : voir le vocabulaire dans `retour.ts`. */
  retour?: Retour | null;
  style?: ViewStyle;
}) {
  return (
    <PressionVivante
      onPress={onPress}
      disabled={disabled}
      retour={retour}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[{ opacity: disabled ? 0.35 : 1 }, style as ViewStyle]}
    >
      <CutFrame accent={accent} fill={colors.panel} corners={['tl', 'br']} cut={10}>
        <Text style={styles.actionLabel}>{label.toUpperCase()}</Text>
      </CutFrame>
    </PressionVivante>
  );
}

// ------------------------------------------------------- badge d'etat

/**
 * Pastille d'etat mise en scene : le losange colore + le libelle en
 * display. Sert aux indicateurs valorises (chiffrement, mesh, en ligne).
 */
export function StatusBadge({
  label,
  color,
  active = true,
}: {
  label: string;
  color: string;
  active?: boolean;
}) {
  return (
    <View style={styles.badgeRow} accessibilityRole="text" accessibilityLabel={`${label} ${active ? 'actif' : 'inactif'}`}>
      <Svg width={9} height={9} viewBox="0 0 10 10">
        <Polygon points="5,0 10,5 5,10 0,5" fill={active ? color : 'transparent'} stroke={color} strokeWidth={1.5} />
      </Svg>
      <Text style={[styles.badgeLabel, { color: active ? color : colors.textFaint }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ------------------------------------------------------- pictogrammes
// Icones geometriques anguleuses, dessinees a la main en SVG.

export function IconLock({ size = 16, color = colors.cyan }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="4,11 20,11 20,22 4,22" fill="none" stroke={color} strokeWidth={2} />
      <Path d="M8 11 V7 L12 4 L16 7 V11" fill="none" stroke={color} strokeWidth={2} />
      <Line x1="12" y1="15" x2="12" y2="18" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function IconMesh({ size = 16, color = colors.magenta }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="12" y1="4" x2="4" y2="18" stroke={color} strokeWidth={1.5} />
      <Line x1="12" y1="4" x2="20" y2="18" stroke={color} strokeWidth={1.5} />
      <Line x1="4" y1="18" x2="20" y2="18" stroke={color} strokeWidth={1.5} />
      <Polygon points="12,1 15,4 12,7 9,4" fill={color} />
      <Polygon points="4,15 7,18 4,21 1,18" fill={color} />
      <Polygon points="20,15 23,18 20,21 17,18" fill={color} />
    </Svg>
  );
}

export function IconScan({ size = 18, color = colors.ember }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 8 V3 H8" fill="none" stroke={color} strokeWidth={2} />
      <Path d="M16 3 H21 V8" fill="none" stroke={color} strokeWidth={2} />
      <Path d="M21 16 V21 H16" fill="none" stroke={color} strokeWidth={2} />
      <Path d="M8 21 H3 V16" fill="none" stroke={color} strokeWidth={2} />
      <Line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/**
 * Logo Blackout : le chiffre 0 cerclé, biseauté — memorable et
 * minimaliste, dans l'esprit du "1" cerclé de DedSec, mais zero
 * (le degre zero de metadonnees : aucun compte, aucun identifiant).
 */
export function LogoMark({ size = 40, color = colors.ember }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityLabel="Blackout">
      <Polygon
        points="10,2 38,2 46,10 46,38 38,46 10,46 2,38 2,10"
        fill="none"
        stroke={color}
        strokeWidth={3}
      />
      <Circle cx="24" cy="24" r="11" fill="none" stroke={color} strokeWidth={3} />
      <Line x1="16" y1="33" x2="32" y2="15" stroke={color} strokeWidth={3} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  actionLabel: {
    ...type.label,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  badgeLabel: { ...type.label, fontSize: 10 },
});
