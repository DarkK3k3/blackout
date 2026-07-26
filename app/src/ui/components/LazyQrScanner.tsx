// LazyQrScanner — charge la camera SEULEMENT quand on ouvre l'onglet
// de scan, jamais au demarrage de l'app.
//
// Pourquoi c'est important : react-native-vision-camera v5 repose sur
// Nitro, qui enregistre des objets natifs des que le module est
// importe. Un import statique le faisait donc s'initialiser au
// lancement — si ca echoue, l'app se ferme sans message. En differant
// l'import, un probleme de camera reste cantonne a l'ecran de scan.
//
// La frontiere d'erreur transforme en plus un echec de chargement en
// message lisible plutot qu'en ecran blanc.

import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, space, type } from '../theme/tokens';

const Inner = React.lazy(async () => {
  const mod = await import('./QrScanner');
  return { default: mod.QrScanner };
});

class CameraBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.center}>
          <Text style={styles.title}>CAMERA INDISPONIBLE</Text>
          <Text style={styles.body}>
            Le scan de QR code n'a pas pu demarrer. Tu peux quand meme faire
            scanner TON code par l'autre personne, depuis l'onglet MON CODE.
          </Text>
          <Text style={styles.detail}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export function LazyQrScanner({ onScanned }: { onScanned: (value: string) => void }) {
  return (
    <CameraBoundary>
      <React.Suspense
        fallback={
          <View style={styles.center}>
            <ActivityIndicator color={colors.ember} />
          </View>
        }
      >
        <Inner onScanned={onScanned} />
      </React.Suspense>
    </CameraBoundary>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md, padding: space.xl },
  title: { ...type.title, color: colors.warn },
  body: { ...type.body, color: colors.textDim, textAlign: 'center' },
  detail: { ...type.dataSmall, color: colors.textFaint, textAlign: 'center' },
});
