// ChatListScreen — l'accueil : "panneau de controle hacktiviste".
// Les indicateurs de securite sont mis en scene EN HAUT (chiffrement,
// relais, mesh), pas relegues dans un coin. En dessous, une liste de
// conversations claire et lisible.

import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { CutFrame } from '../components/CutFrame';
import { Scanlines } from '../components/Glitch';
import { ActionButton, StatusBadge, IconLock, IconMesh, LogoMark } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { Avatar } from '../components/Avatar';
import { PressionVivante } from '../components/Vivant';
import { colors, space, type } from '../theme/tokens';

export interface ChatSummary {
  id: string;
  title: string;
  kind: 'direct' | 'group';
  lastMessage: string | null;
  lastAt: number | null;
  verified: boolean;
  memberCount?: number;
  /** Cle publique du contact : sert a dessiner son empreinte visuelle. */
  identityKey?: string;
}

export interface ChatListScreenProps {
  chats: ChatSummary[];
  relayConnected: boolean;
  meshActive: boolean;
  onOpenChat: (id: string) => void;
  onAddContact: () => void;
  onOpenSettings?: () => void;
  onOpenMap?: () => void;
}

function timeLabel(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ChatListScreen({
  chats,
  relayConnected,
  meshActive,
  onOpenChat,
  onAddContact,
  onOpenSettings,
  onOpenMap,
}: ChatListScreenProps) {
  return (
    <Screen style={styles.root}>
      <Scanlines opacity={0.035} />

      <View style={styles.header}>
        <LogoMark size={34} />
        <Text style={styles.brand}>BLACKOUT</Text>
        {onOpenSettings ? (
          <Pressable
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Reglages"
            style={styles.settingsButton}
          >
            <Text style={styles.settingsGlyph}>⌘</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Panneau de controle : les etats de securite, valorises */}
      <CutFrame accent={colors.line} corners={['tl', 'br']} style={styles.statusPanel}>
        <View style={styles.statusInner}>
          <View style={styles.statusItem}>
            <IconLock size={15} />
            <StatusBadge label="E2EE actif" color={colors.cyan} />
          </View>
          <View style={styles.statusItem}>
            <StatusBadge
              label={relayConnected ? 'Relais connecte' : 'Hors ligne'}
              color={relayConnected ? colors.cyan : colors.textFaint}
              active={relayConnected}
            />
          </View>
          <Pressable onPress={onOpenMap} accessibilityRole="button" accessibilityLabel="Voir les positions" style={styles.statusItem}>
            <StatusBadge label="positions" color={colors.magenta} />
          </Pressable>
          <View style={styles.statusItem}>
            <IconMesh size={15} color={meshActive ? colors.magenta : colors.textFaint} />
            <StatusBadge label="Mesh BLE" color={colors.magenta} active={meshActive} />
          </View>
        </View>
      </CutFrame>

      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Aucune conversation.{'\n'}Ajoute un contact en scannant son QR code.
          </Text>
        }
        renderItem={({ item }) => (
          <PressionVivante onPress={() => onOpenChat(item.id)} accessibilityRole="button">
            <CutFrame
              accent={item.verified ? colors.cyan : colors.line}
              corners={['tl']}
              cut={10}
              style={styles.row}
            >
              <View style={styles.rowAvecAvatar}>
                {/* L'empreinte visuelle est calculee a partir de la cle :
                    si la cle change, le motif change, et l'anomalie se
                    voit sans ouvrir de menu. */}
                <Avatar
                  cleIdentite={item.identityKey ?? ''}
                  initiales={item.title.slice(0, 2).toUpperCase()}
                  verifie={item.verified}
                  taille={40}
                />
                <View style={styles.rowInner}>
                  <View style={styles.rowTop}>
                    <Text style={styles.chatTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.time}>{timeLabel(item.lastAt)}</Text>
                  </View>
                  <View style={styles.rowBottom}>
                    <Text style={styles.preview} numberOfLines={1}>
                      {item.lastMessage ?? '—'}
                    </Text>
                    {item.verified ? (
                      <StatusBadge label="verifie" color={colors.cyan} />
                    ) : (
                      <StatusBadge label="non verifie" color={colors.warn} active={false} />
                    )}
                  </View>
                </View>
              </View>
            </CutFrame>
          </PressionVivante>
        )}
      />

      <ActionButton label="+ Ajouter un contact" onPress={onAddContact} style={styles.cta} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  brand: { ...type.hero, color: colors.text, flex: 1 },
  settingsButton: { padding: space.sm },
  settingsGlyph: { color: colors.textDim, fontSize: 20 },
  statusPanel: { marginHorizontal: space.lg, marginBottom: space.lg },
  statusInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.lg,
    padding: space.md,
  },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  list: { paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.xl },
  row: { marginBottom: space.sm },
  rowAvecAvatar: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  rowInner: { flex: 1, gap: space.xs },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
  chatTitle: { ...type.title, color: colors.text, flexShrink: 1 },
  time: { ...type.dataSmall, color: colors.textDim },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  preview: { ...type.body, color: colors.textDim, flexShrink: 1 },
  empty: { ...type.body, color: colors.textFaint, textAlign: 'center', marginTop: space.xxl },
  cta: { marginHorizontal: space.lg, marginBottom: space.xl },
});
