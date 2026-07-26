// AddContactScreen — mise en relation strictement out-of-band.
//
// Deux onglets : MON CODE (j'affiche mon QR d'invitation) et SCANNER
// (je lis celui de l'autre). Aucun numero, aucun email, aucun pseudo
// public, aucune recherche sur le serveur : la seule facon d'entrer en
// contact est d'etre physiquement face a la personne (ou de recevoir
// son QR par un canal qu'on juge sur).
//
// Le composant de scan est injecte (`Scanner`) : la camera est un
// module natif, on la garde hors de ce fichier pour que l'ecran reste
// testable et que la camera ne demarre que sur l'onglet concerne.

import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CutFrame } from '../components/CutFrame';
import { StatusBadge, IconScan, LogoMark, ActionButton } from '../components/Primitives';
import { colors, space, type } from '../theme/tokens';

export interface AddContactScreenProps {
  /** Contenu du QR : reference courte + empreinte, PAS les cles. */
  invitePayload: string;
  /** Meme information, dictable a voix haute quand le scan est impossible. */
  spokenCode: string;
  /** Empreinte courte de mon identite, affichee sous le QR. */
  myShortFingerprint: string;
  /** Rendu de la camera : injecte pour rester testable et econome. */
  Scanner?: React.ComponentType<{ onScanned: (value: string) => void }>;
  onScanned: (value: string) => void;
  /** Code dicte, saisi a la main : indispensable si la camera refuse. */
  onSubmitCode: (code: string) => void;
  error?: string | null;
}

type Tab = 'mine' | 'scan' | 'type';

const TAB_LABELS: Record<Tab, string> = {
  mine: 'MON CODE',
  scan: 'SCANNER',
  type: 'SAISIR',
};

export function AddContactScreen({
  invitePayload,
  spokenCode,
  myShortFingerprint,
  Scanner,
  onScanned,
  onSubmitCode,
  error,
}: AddContactScreenProps) {
  const [tab, setTab] = React.useState<Tab>('mine');
  const [typedCode, setTypedCode] = React.useState('');

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {(['mine', 'scan', 'type'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{TAB_LABELS[t]}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'mine' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <LogoMark size={30} />
          <Text style={styles.heading}>Fais scanner ce code</Text>
          <CutFrame accent={colors.ember} corners={['tl', 'br']}>
            <View style={styles.qrPanel}>
              <View style={styles.qrBox}>
                <QRCode
                  value={invitePayload}
                  size={220}
                  backgroundColor={colors.text}
                  color={colors.void}
                  quietZone={8}
                />
              </View>
              <Text style={styles.fingerprint} selectable>
                {myShortFingerprint}
              </Text>
              <StatusBadge label="usage unique" color={colors.ember} />
            </View>
          </CutFrame>

          <Text style={styles.orLabel}>OU DICTE CE CODE</Text>
          <CutFrame accent={colors.line} corners={['tl']} style={styles.spokenPanel}>
            <Text style={styles.spokenCode} selectable>
              {spokenCode}
            </Text>
          </CutFrame>

          <Text style={styles.help}>
            Ce code ne contient aucune cle : juste ou les recuperer, et une
            empreinte qui garantit qu'elles n'ont pas ete remplacees en route.
            Aucun numero, aucun email, aucun identifiant de compte — et il est
            a usage unique : reaffiche-le pour chaque nouvelle personne.
          </Text>
        </ScrollView>
      ) : tab === 'scan' ? (
        <View style={styles.scanArea}>
          {Scanner ? (
            <Scanner onScanned={onScanned} />
          ) : (
            <View style={styles.scanPlaceholder}>
              <IconScan size={40} />
              <Text style={styles.help}>Camera indisponible sur cet appareil.</Text>
            </View>
          )}
          <View pointerEvents="none" style={styles.reticle}>
            <CutFrame accent={colors.cyan} fill="transparent" corners={['tl', 'tr', 'br', 'bl']} cut={26} style={styles.reticleFrame} />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.heading}>Saisis le code</Text>
          <Text style={styles.help}>
            Le code affiche sous le QR de l'autre personne. Les tirets et la
            casse n'ont pas d'importance.
          </Text>
          <TextInput
            value={typedCode}
            onChangeText={setTypedCode}
            placeholder="ABCDE-FGHIJ-KLMNO…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            multiline
            style={styles.codeInput}
            accessibilityLabel="Code d'invitation"
          />
          <ActionButton
            label="Ajouter ce contact"
            onPress={() => onSubmitCode(typedCode)}
            disabled={typedCode.trim().length < 10}
            style={styles.submit}
          />
          {error ? <Text style={styles.typedError}>{error}</Text> : null}
          <Text style={styles.help}>
            Cette methode suppose que vous utilisez le meme serveur relais :
            le code dicte ne transporte pas son adresse.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void, paddingTop: space.xl },
  tabs: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg },
  tab: { paddingVertical: space.sm, paddingHorizontal: space.lg, borderBottomWidth: 2, borderBottomColor: colors.line },
  tabActive: { borderBottomColor: colors.ember },
  tabLabel: { ...type.label, color: colors.textFaint },
  tabLabelActive: { color: colors.text },
  content: { alignItems: 'center', gap: space.md, padding: space.lg },
  heading: { ...type.title, color: colors.text },
  qrPanel: { alignItems: 'center', gap: space.md, padding: space.lg },
  qrBox: { backgroundColor: colors.text, padding: space.sm },
  fingerprint: { ...type.dataSmall, color: colors.cyan },
  orLabel: { ...type.label, color: colors.textDim, marginTop: space.sm },
  spokenPanel: { alignSelf: 'stretch' },
  spokenCode: { ...type.data, color: colors.cyan, textAlign: 'center', padding: space.md, lineHeight: 22 },
  help: { ...type.body, color: colors.textDim, textAlign: 'center' },
  codeInput: {
    ...type.data,
    color: colors.text,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    minHeight: 90,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  submit: { alignSelf: 'stretch' },
  typedError: { ...type.body, color: colors.danger, textAlign: 'center' },
  scanArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanPlaceholder: { alignItems: 'center', gap: space.md, padding: space.xl },
  reticle: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  reticleFrame: { width: 250, height: 250 },
  error: { ...type.body, color: colors.danger, position: 'absolute', bottom: space.xxl, paddingHorizontal: space.lg, textAlign: 'center' },
});
