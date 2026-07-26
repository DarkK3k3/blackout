// SettingsScreen — l'adresse du relais, modifiable sans recompiler.
//
// Elle etait figee au moment du build : en changer imposait 12 minutes
// de compilation, une reinstallation, et un cycle de signature de 7
// jours gaspille. Elle se regle desormais ici, et le bouton TESTER
// verifie qu'elle repond AVANT d'enregistrer.

import React from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { CutFrame } from '../components/CutFrame';
import { ActionButton, StatusBadge } from '../components/Primitives';
import { colors, space, type } from '../theme/tokens';

export type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'failed'; message: string };

export interface SettingsScreenProps {
  relayUrl: string;
  displayName: string;
  myPublicKeyShort: string;
  testState: TestState;
  onChangeRelayUrl: (url: string) => void;
  onChangeDisplayName: (name: string) => void;
  onTest: () => void;
  onSave: () => void;
}

export function SettingsScreen({
  relayUrl,
  displayName,
  myPublicKeyShort,
  testState,
  onChangeRelayUrl,
  onChangeDisplayName,
  onTest,
  onSave,
}: SettingsScreenProps) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>SERVEUR RELAIS</Text>
      <CutFrame accent={colors.line} corners={['tl', 'br']}>
        <View style={styles.panel}>
          <TextInput
            value={relayUrl}
            onChangeText={onChangeRelayUrl}
            placeholder="https://mon-relais.exemple.fr"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            accessibilityLabel="Adresse du serveur relais"
          />
          <View style={styles.row}>
            <ActionButton label="Tester" onPress={onTest} accent={colors.cyan} style={styles.flex} />
            {testState.kind === 'testing' ? <StatusBadge label="test en cours" color={colors.warn} /> : null}
            {testState.kind === 'ok' ? <StatusBadge label="repond" color={colors.cyan} /> : null}
            {testState.kind === 'failed' ? <StatusBadge label="echec" color={colors.danger} /> : null}
          </View>
          {testState.kind === 'failed' ? <Text style={styles.error}>{testState.message}</Text> : null}
        </View>
      </CutFrame>

      <Text style={styles.help}>
        Le relais ne voit jamais tes messages en clair : il ne transporte que des
        blobs chiffres. Tu peux en changer a tout moment, tes conversations et tes
        cles restent intactes.
      </Text>

      <Text style={styles.kicker}>NOM AFFICHE</Text>
      <CutFrame accent={colors.line} corners={['tl']}>
        <View style={styles.panel}>
          <TextInput
            value={displayName}
            onChangeText={onChangeDisplayName}
            placeholder="Ton prenom"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            accessibilityLabel="Nom affiche a tes contacts"
          />
        </View>
      </CutFrame>

      <Text style={styles.kicker}>MON IDENTITE</Text>
      <CutFrame accent={colors.line} corners={['tl']}>
        <View style={styles.panel}>
          <Text style={styles.fingerprint} selectable>
            {myPublicKeyShort}
          </Text>
          <Text style={styles.note}>
            Empreinte de ta cle publique. Elle est generee sur cet appareil et n'en
            sort jamais.
          </Text>
        </View>
      </CutFrame>

      <ActionButton label="Enregistrer" onPress={onSave} style={styles.save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  kicker: { ...type.label, color: colors.textDim, marginTop: space.md },
  panel: { padding: space.md, gap: space.md },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.void,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  error: { ...type.meta, color: colors.danger },
  help: { ...type.meta, color: colors.textFaint, lineHeight: 16 },
  fingerprint: { ...type.data, color: colors.cyan },
  note: { ...type.meta, color: colors.textFaint, lineHeight: 16 },
  save: { marginTop: space.lg },
});
