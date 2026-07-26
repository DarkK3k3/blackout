// ConversationScreen — la lecture prime.
// Les bulles restent sobres et tres lisibles ; le glitch ne joue QUE
// sur les messages qui viennent d'arriver (dechiffrement a l'affichage),
// jamais sur l'historique deja lu.

import React from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CutFrame } from '../components/CutFrame';
import { GlitchText } from '../components/Glitch';
import { StatusBadge, IconLock } from '../components/Primitives';
import { colors, space, type } from '../theme/tokens';

export interface ChatMessage {
  id: string;
  body: string;
  mine: boolean;
  senderName?: string;
  sentAt: number;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  /** true = arrive a l'instant : declenche le glitch de dechiffrement. */
  fresh?: boolean;
}

export interface ConversationScreenProps {
  title: string;
  verified: boolean;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onSendPhoto?: () => void;
  onOpenVerification: () => void;
}

const STATUS_MARK: Record<ChatMessage['status'], string> = {
  pending: '···',
  sent: '✓',
  delivered: '✓✓',
  failed: '!',
};

export function ConversationScreen({
  title,
  verified,
  messages,
  onSend,
  onSendPhoto,
  onOpenVerification,
}: ConversationScreenProps) {
  const [draft, setDraft] = React.useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable onPress={onOpenVerification} accessibilityRole="button" style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.headerBadges}>
            <IconLock size={13} />
            <StatusBadge label="chiffre" color={colors.cyan} />
            <StatusBadge
              label={verified ? 'verifie' : 'a verifier'}
              color={verified ? colors.cyan : colors.warn}
              active={verified}
            />
          </View>
        </View>
      </Pressable>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.bubbleWrap, item.mine ? styles.mineWrap : styles.theirsWrap]}>
            <CutFrame
              accent={item.mine ? colors.ember : colors.line}
              fill={item.mine ? colors.panelRaised : colors.panel}
              corners={item.mine ? ['tl', 'br'] : ['tr', 'bl']}
              cut={10}
            >
              <View style={styles.bubble}>
                {!item.mine && item.senderName ? (
                  <Text style={styles.sender}>{item.senderName}</Text>
                ) : null}
                {/* Le glitch ne concerne que les messages fraichement dechiffres */}
                <GlitchText text={item.body} disabled={!item.fresh} style={styles.body} />
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>
                    {new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {item.mine ? (
                    <Text
                      style={[styles.meta, item.status === 'failed' && { color: colors.danger }]}
                    >
                      {STATUS_MARK[item.status]}
                    </Text>
                  ) : null}
                </View>
              </View>
            </CutFrame>
          </View>
        )}
      />

      <View style={styles.composer}>
        {onSendPhoto ? (
          <Pressable
            onPress={onSendPhoto}
            accessibilityRole="button"
            accessibilityLabel="Envoyer une photo"
            style={styles.photoButton}
          >
            <Text style={styles.photoGlyph}>▣</Text>
          </Pressable>
        ) : null}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message chiffre…"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          multiline
          accessibilityLabel="Zone de saisie du message"
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Envoyer"
          style={({ pressed }) => [styles.sendButton, { opacity: !draft.trim() ? 0.35 : pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.sendLabel}>▶</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerText: { gap: space.xs },
  title: { ...type.title, color: colors.text },
  headerBadges: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  list: { padding: space.lg, gap: space.sm },
  bubbleWrap: { maxWidth: '82%', marginBottom: space.sm },
  mineWrap: { alignSelf: 'flex-end' },
  theirsWrap: { alignSelf: 'flex-start' },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2 },
  sender: { ...type.label, fontSize: 10, color: colors.magenta },
  body: { ...type.body, color: colors.text },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: space.xs },
  meta: { ...type.dataSmall, color: colors.textDim },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.panel,
  },
  photoButton: { paddingHorizontal: space.sm, paddingVertical: space.sm },
  photoGlyph: { color: colors.cyan, fontSize: 20 },
  input: {
    flex: 1,
    ...type.body,
    color: colors.text,
    backgroundColor: colors.void,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    maxHeight: 120,
  },
  sendButton: { backgroundColor: colors.ember, paddingHorizontal: space.lg, paddingVertical: space.md },
  sendLabel: { color: colors.void, fontSize: 16, fontWeight: '900' },
});
