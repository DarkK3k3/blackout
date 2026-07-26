// Glitch — clin d'oeil visuel, jamais un gadget permanent.
//
// GlitchText : au montage (ex. un message qui vient d'etre dechiffre),
// le texte "resout" brievement — quelques trames de caracteres
// parasites, puis le vrai texte, definitivement stable. Aucune
// animation en boucle : rien ne bouge pendant la lecture.
//
// Scanlines : fines lignes horizontales statiques, tres faible
// opacite, purement decoratives (pointerEvents none).

import React from 'react';
import { Text, View, StyleSheet, type TextProps, type ViewStyle } from 'react-native';
import { colors } from '../theme/tokens';

const NOISE = '01#%&$@!/\\|<>*+=';

function scramble(source: string, revealed: number): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    if (i < revealed || source[i] === ' ' || source[i] === '\n') out += source[i];
    else out += NOISE[Math.floor(Math.random() * NOISE.length)];
  }
  return out;
}

export interface GlitchTextProps extends TextProps {
  text: string;
  /** Duree totale de la resolution, en ms. 0 = pas d'effet. */
  duration?: number;
  /** Desactive l'effet (ex. messages deja lus au chargement de l'ecran). */
  disabled?: boolean;
}

export function GlitchText({ text, duration = 320, disabled = false, style, ...rest }: GlitchTextProps) {
  const [display, setDisplay] = React.useState(disabled || duration === 0 ? text : scramble(text, 0));

  React.useEffect(() => {
    if (disabled || duration === 0) {
      setDisplay(text);
      return;
    }
    // ~8 trames : assez pour l'effet, trop court pour gener la lecture
    const frames = 8;
    const step = Math.max(16, Math.round(duration / frames));
    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      if (frame >= frames) {
        clearInterval(id);
        setDisplay(text); // etat final : le vrai texte, toujours
      } else {
        setDisplay(scramble(text, Math.floor((text.length * frame) / frames)));
      }
    }, step);
    return () => clearInterval(id);
  }, [text, duration, disabled]);

  return (
    <Text style={style} {...rest}>
      {display}
    </Text>
  );
}

export function Scanlines({ opacity = 0.05, style }: { opacity?: number; style?: ViewStyle }) {
  const lines = Array.from({ length: 60 });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {lines.map((_, i) => (
        <View
          key={i}
          style={{
            height: StyleSheet.hairlineWidth,
            marginBottom: 3,
            backgroundColor: colors.cyan,
            opacity,
          }}
        />
      ))}
    </View>
  );
}
