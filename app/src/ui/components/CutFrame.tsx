// CutFrame — cadre a coins coupes (biseaux), brique visuelle de base.
// Remplace les "cartes toutes rondes" des apps grand public : angles
// francs facon interface de hacking. Optionnellement, un liseré neon.

import React from 'react';
import { View, StyleSheet, type ViewProps, type ViewStyle } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { colors, CUT } from '../theme/tokens';

type Corner = 'tl' | 'tr' | 'br' | 'bl';

export interface CutFrameProps extends ViewProps {
  /** Couleur du liseré. `null` = pas de liseré (cadre plein seul). */
  accent?: string | null;
  /** Fond du cadre. */
  fill?: string;
  /** Coins a biseauter. Par defaut : haut-gauche et bas-droite. */
  corners?: Corner[];
  cut?: number;
  borderWidth?: number;
  style?: ViewStyle | ViewStyle[];
}

/** Points du polygone biseauté, en pourcentages du viewBox 100x100. */
function polygonPoints(corners: Corner[], cutX: number, cutY: number): string {
  const has = (c: Corner) => corners.includes(c);
  const pts: [number, number][] = [];
  // coin haut-gauche
  if (has('tl')) pts.push([0, cutY], [cutX, 0]);
  else pts.push([0, 0]);
  // haut-droite
  if (has('tr')) pts.push([100 - cutX, 0], [100, cutY]);
  else pts.push([100, 0]);
  // bas-droite
  if (has('br')) pts.push([100, 100 - cutY], [100 - cutX, 100]);
  else pts.push([100, 100]);
  // bas-gauche
  if (has('bl')) pts.push([cutX, 100], [0, 100 - cutY]);
  else pts.push([0, 100]);
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}

export function CutFrame({
  accent = colors.line,
  fill = colors.panel,
  corners = ['tl', 'br'],
  cut = CUT,
  borderWidth = 1,
  style,
  children,
  ...rest
}: CutFrameProps) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  // Le viewBox est en pourcentages : on convertit la coupe (en px) en %
  // pour que le biseau garde un angle constant quelle que soit la taille.
  const cutX = size.width ? (cut / size.width) * 100 : 4;
  const cutY = size.height ? (cut / size.height) * 100 : 4;
  const points = polygonPoints(corners, cutX, cutY);

  return (
    <View
      style={style}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      {...rest}
    >
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Polygon
          points={points}
          fill={fill}
          stroke={accent ?? 'none'}
          strokeWidth={accent ? borderWidth : 0}
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
      {children}
    </View>
  );
}
