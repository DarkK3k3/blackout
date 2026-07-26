// VerificationScreen — le code de verification mensuel, mis en scene.
//
// Affiche le code du mois en TRES gros (mono, lisible a voix haute),
// double d'un QR scannable, plus l'empreinte du couple. Le texte
// explique pourquoi ca tourne chaque mois SANS jamais casser la
// conversation : c'est un calcul en lecture seule sur les cles
// d'identite, totalement independant du Double Ratchet.

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CutFrame } from '../components/CutFrame';
import { Scanlines } from '../components/Glitch';
import { ActionButton, StatusBadge, IconLock } from '../components/Primitives';
import { colors, space, type } from '../theme/tokens';

export interface VerificationScreenProps {
  contactName: string;
  /** Code du mois, ex. "9821-6195". */
  code: string;
  /** Mois courant "AAAA-MM". */
  yearMonth: string;
  /** Empreinte du couple, hex — affichee en petit, pour les curieux. */
  fingerprintHex: string;
  verified: boolean;
  onMarkVerified: () => void;
}

/** Empreinte hex decoupee en groupes lisibles. */
function groupFingerprint(hex: string): string {
  return (hex.match(/.{1,8}/g) ?? []).join(' ');
}

export function VerificationScreen({
  contactName,
  code,
  yearMonth,
  fingerprintHex,
  verified,
  onMarkVerified,
}: VerificationScreenProps) {
  // Le QR encode le meme code que l'affichage numerique : les deux
  // methodes de comparaison sont strictement equivalentes.
  const qrPayload = `blackout-verify:${yearMonth}:${code}`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Scanlines opacity={0.04} />

      <Text style={styles.kicker}>Code de verification</Text>
      <Text style={styles.title}>{contactName.toUpperCase()}</Text>

      <CutFrame accent={colors.cyan} corners={['tl', 'br']} style={styles.codePanel}>
        <View style={styles.codeInner}>
          <Text style={styles.month}>{yearMonth}</Text>
          <Text style={styles.code} accessibilityLabel={`Code du mois : ${code.split('').join(' ')}`}>
            {code}
          </Text>
          <View style={styles.qrBox}>
            <QRCode
              value={qrPayload}
              size={168}
              backgroundColor={colors.text}
              color={colors.void}
              quietZone={8}
            />
          </View>
          <View style={styles.badges}>
            <IconLock size={14} />
            <StatusBadge label={verified ? 'verifie' : 'a comparer'} color={verified ? colors.cyan : colors.warn} active={verified} />
          </View>
        </View>
      </CutFrame>

      <Text style={styles.help}>
        Comparez ce code avec {contactName} — de vive voix, ou en scannant son QR.
        S'ils sont identiques, personne ne s'intercale entre vous.
      </Text>

      <CutFrame accent={colors.line} corners={['tl']} style={styles.fpPanel}>
        <View style={styles.fpInner}>
          <Text style={styles.fpLabel}>EMPREINTE DU COUPLE</Text>
          <Text style={styles.fpValue} selectable>
            {groupFingerprint(fingerprintHex)}
          </Text>
          <Text style={styles.note}>
            Le code change chaque mois : il est derive de cette empreinte fixe
            + le mois en cours. C'est un calcul en lecture seule sur vos cles
            d'identite — il ne touche jamais au chiffrement en cours et ne
            coupe jamais la conversation.
          </Text>
        </View>
      </CutFrame>

      {!verified ? (
        <ActionButton label="Les codes correspondent" onPress={onMarkVerified} accent={colors.cyan} style={styles.cta} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, paddingTop: space.xxl, gap: space.md },
  kicker: { ...type.label, color: colors.textDim },
  title: { ...type.hero, color: colors.text, marginBottom: space.sm },
  codePanel: {},
  codeInner: { alignItems: 'center', padding: space.lg, gap: space.md },
  month: { ...type.dataSmall, color: colors.cyan },
  code: { ...type.data, fontSize: 38, color: colors.text, letterSpacing: 4 },
  qrBox: { backgroundColor: colors.text, padding: space.sm },
  badges: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  help: { ...type.body, color: colors.textDim },
  fpPanel: { marginTop: space.sm },
  fpInner: { padding: space.md, gap: space.sm },
  fpLabel: { ...type.label, fontSize: 10, color: colors.textDim },
  fpValue: { ...type.dataSmall, color: colors.cyan, lineHeight: 18 },
  note: { ...type.meta, color: colors.textFaint, lineHeight: 16 },
  cta: { marginTop: space.md, marginBottom: space.xxl },
});
