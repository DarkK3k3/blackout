// MapScreen — carte des positions partagees.
//
// Difference de fond avec les applications de localisation familiale
// grand public : ici le serveur ne voit RIEN. Les positions voyagent
// chiffrees dans la meme session que les messages.
//
// L'ergonomie s'en inspire en revanche volontiers : la carte occupe
// tout l'ecran, et une bande de cartes-contacts glisse en bas. Toucher
// quelqu'un centre la carte sur lui. L'information la plus utile —
// « a quelle distance » et « ca date de quand » — est lisible d'un
// coup d'oeil, sans ouvrir de menu.

import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Dimensions } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { CutFrame } from '../components/CutFrame';
import { ActionButton, StatusBadge } from '../components/Primitives';
import { GlitchText, Scanlines } from '../components/Glitch';
import { useSafeInsets } from '../components/Screen';
import {
  distanceM,
  distanceLisible,
  initiales,
  ageLisible,
  resteLisible,
  etatDeplacement,
  pointCardinal,
  fraicheur,
} from './mapMath';
import { colors, space, type } from '../theme/tokens';

export interface SharedLocation {
  contactId: string;
  displayName: string;
  verified: boolean;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  measuredAt: number;
  /** Vitesse deduite de deux relevés successifs, en km/h. */
  vitesseKmh?: number | null;
  /** Cap deduit de deux relevés successifs, en degres depuis le nord. */
  capDeg?: number | null;
}

export interface OutgoingShare {
  contactId: string;
  displayName: string;
  until: number;
}

export interface MapScreenProps {
  locations: SharedLocation[];
  /** Partages que J'AI ouverts : qui me voit, et jusqu'a quand. */
  outgoing: OutgoingShare[];
  /** Ma propre position, pour calculer les distances. */
  myPosition?: { latitude: number; longitude: number } | null;
  permissionGranted: boolean;
  onRequestPermission: () => void;
  onStopSharing: (contactId: string) => void;
  onForget: (contactId: string) => void;
  onOpenChat?: (contactId: string) => void;
}

const CARD_WIDTH = Math.min(280, Dimensions.get('window').width * 0.75);
// Les scanlines occupent 4 px chacune : on en met assez pour couvrir
// l'ecran, sans quoi elles s'arreteraient au milieu de la carte.
const SCANLINE_COUNT = Math.ceil(Dimensions.get('window').height / 4);

/** Position trop vieille pour etre presentee comme les autres. */
function estPerimee(l: SharedLocation): boolean {
  return fraicheur(l.measuredAt) === 'PERIME';
}

export function MapScreen({
  locations,
  outgoing,
  myPosition,
  permissionGranted,
  onRequestPermission,
  onStopSharing,
  onForget,
  onOpenChat,
}: MapScreenProps) {
  const insets = useSafeInsets();
  const mapRef = React.useRef<MapView>(null);
  const [selection, setSelection] = React.useState<string | null>(null);
  // Le trafic vient des tuiles de la carte : aucune position d'ami
  // n'est envoyee pour l'obtenir. Eteint par defaut — il charge la vue.
  const [trafic, setTrafic] = React.useState(false);

  const regionInitiale = React.useMemo((): Region | undefined => {
    const points = [...locations, ...(myPosition ? [myPosition] : [])];
    if (points.length === 0) return undefined;
    const lats = points.map((l) => l.latitude);
    const lons = points.map((l) => l.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.8),
      longitudeDelta: Math.max(0.01, (maxLon - minLon) * 1.8),
    };
  }, [locations, myPosition]);

  const centrerSur = React.useCallback((l: SharedLocation) => {
    setSelection(l.contactId);
    mapRef.current?.animateToRegion(
      { latitude: l.latitude, longitude: l.longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 },
      450,
    );
  }, []);

  const toutVoir = React.useCallback(() => {
    setSelection(null);
    if (regionInitiale) mapRef.current?.animateToRegion(regionInitiale, 450);
  }, [regionInitiale]);

  if (locations.length === 0 && outgoing.length === 0) {
    return (
      <View style={styles.emptyRoot}>
        <Text style={styles.emptyTitle}>PERSONNE EN VUE</Text>
        <Text style={styles.emptyBody}>
          Aucun partage en cours. Ouvre une conversation et touche l'icone de
          position pour partager la tienne, ou demande a quelqu'un de partager
          la sienne.
        </Text>
        {!permissionGranted ? (
          <ActionButton label="Autoriser la localisation" onPress={onRequestPermission} />
        ) : null}
        <Text style={styles.emptyNote}>
          Les positions sont chiffrees comme tes messages : le serveur ne peut
          pas les lire, et rien n'est conserve en dehors de ton telephone.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={regionInitiale}
        userInterfaceStyle="dark"
        showsUserLocation={permissionGranted}
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={trafic}
      >
        {locations.map((l) => (
          <React.Fragment key={l.contactId}>
            {l.accuracyM ? (
              // Le cercle rend la PRECISION visible : une position a 500 m
              // pres ne doit pas ressembler a une position exacte.
              <Circle
                center={{ latitude: l.latitude, longitude: l.longitude }}
                radius={l.accuracyM}
                strokeColor={l.verified ? colors.cyan : colors.warn}
                fillColor={l.verified ? 'rgba(0,229,255,0.10)' : 'rgba(255,179,0,0.10)'}
                strokeWidth={1}
              />
            ) : null}
            <Marker
              coordinate={{ latitude: l.latitude, longitude: l.longitude }}
              onPress={() => centrerSur(l)}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View
                style={[
                  styles.pin,
                  { borderColor: l.verified ? colors.cyan : colors.warn },
                  selection === l.contactId && styles.pinSelected,
                  // Une position perimee ne doit pas avoir l'air aussi
                  // sure que les autres : on regarde une carte pour
                  // savoir ou quelqu'un est MAINTENANT.
                  estPerimee(l) && styles.pinPerime,
                ]}
              >
                <Text style={styles.pinText}>{initiales(l.displayName)}</Text>
              </View>
            </Marker>
          </React.Fragment>
        ))}
      </MapView>

      {/* Habillage : purement decoratif, ne capte aucun toucher. */}
      <Scanlines opacity={0.035} count={SCANLINE_COUNT} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.coin, styles.coinHG, { top: insets.top + space.sm }]} />
        <View style={[styles.coin, styles.coinHD, { top: insets.top + space.sm }]} />
      </View>

      {/* Bandeau haut : ce que les autres voient de MOI */}
      {outgoing.length > 0 ? (
        <View style={[styles.topBanner, { paddingTop: insets.top + space.sm }]}>
          {outgoing.map((o) => (
            <Pressable
              key={o.contactId}
              onPress={() => onStopSharing(o.contactId)}
              accessibilityRole="button"
              accessibilityLabel={`Arreter le partage avec ${o.displayName}`}
              style={styles.bannerRow}
            >
              <StatusBadge label={`${o.displayName} te voit`} color={colors.ember} />
              <Text style={styles.bannerRight}>{resteLisible(o.until)} · ARRETER</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.outils, { top: insets.top + (outgoing.length > 0 ? 76 : 12) }]}>
        {locations.length > 1 ? (
          <Pressable
            onPress={toutVoir}
            accessibilityRole="button"
            accessibilityLabel="Voir tout le monde"
            style={styles.outil}
          >
            <Text style={styles.outilTexte}>TOUT VOIR</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setTrafic((t) => !t)}
          accessibilityRole="button"
          accessibilityState={{ selected: trafic }}
          accessibilityLabel={trafic ? 'Masquer le trafic routier' : 'Afficher le trafic routier'}
          style={[styles.outil, trafic && styles.outilActif]}
        >
          <Text style={[styles.outilTexte, trafic && styles.outilTexteActif]}>TRAFIC</Text>
        </Pressable>
      </View>

      {/* Bande de cartes : l'essentiel lisible sans ouvrir de menu */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.cards, { bottom: Math.max(insets.bottom, space.md) }]}
        contentContainerStyle={styles.cardsContent}
        snapToInterval={CARD_WIDTH + space.sm}
        decelerationRate="fast"
      >
        {locations.map((l) => {
          const d = myPosition ? distanceM(myPosition, l) : null;
          return (
            <Pressable key={l.contactId} onPress={() => centrerSur(l)} accessibilityRole="button">
              <CutFrame
                accent={selection === l.contactId ? colors.cyan : colors.line}
                corners={['tl', 'br']}
                style={[styles.card, { width: CARD_WIDTH }]}
              >
                <View style={styles.cardInner}>
                  <View style={[styles.avatar, { borderColor: l.verified ? colors.cyan : colors.warn }]}>
                    <Text style={styles.avatarText}>{initiales(l.displayName)}</Text>
                  </View>
                  <View style={styles.cardText}>
                    {/* La resolution glitch se rejoue a chaque nouvelle
                        position (cle sur measuredAt) : c'est ce qui
                        signale du coin de l'oeil que ca vient de bouger. */}
                    <GlitchText
                      key={l.measuredAt}
                      text={l.displayName}
                      duration={260}
                      style={styles.cardName}
                      numberOfLines={1}
                    />
                    <Text style={styles.cardMeta}>
                      {d !== null ? `a ${distanceLisible(d)}` : 'distance inconnue'}
                      {l.capDeg !== null && l.capDeg !== undefined ? ` · ${pointCardinal(l.capDeg)}` : ''}
                      {typeof l.vitesseKmh === 'number' ? ` · ${Math.round(l.vitesseKmh)} km/h` : ''}
                    </Text>
                    <View style={styles.cardEtats}>
                      <StatusBadge
                        label={fraicheur(l.measuredAt)}
                        color={estPerimee(l) ? colors.warn : colors.cyan}
                        active={!estPerimee(l)}
                      />
                      <Text style={styles.cardMeta}>{ageLisible(l.measuredAt)}</Text>
                    </View>
                    {etatDeplacement(l.vitesseKmh ?? null) ? (
                      <Text style={styles.cardMouvement}>{etatDeplacement(l.vitesseKmh ?? null)}</Text>
                    ) : null}
                    {l.accuracyM && l.accuracyM > 100 ? (
                      <Text style={styles.cardWarn}>position approximative</Text>
                    ) : null}
                    {!l.verified ? (
                      <StatusBadge label="non verifie" color={colors.warn} active={false} />
                    ) : null}
                  </View>
                </View>
                <View style={styles.cardActions}>
                  {onOpenChat ? (
                    <Pressable
                      onPress={() => onOpenChat(l.contactId)}
                      accessibilityRole="button"
                      accessibilityLabel={`Ecrire a ${l.displayName}`}
                      style={styles.cardAction}
                    >
                      <Text style={styles.cardActionText}>ECRIRE</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => onForget(l.contactId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Oublier la position de ${l.displayName}`}
                    style={styles.cardAction}
                  >
                    <Text style={styles.cardActionDim}>OUBLIER</Text>
                  </Pressable>
                </View>
              </CutFrame>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  emptyRoot: {
    flex: 1,
    backgroundColor: colors.void,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
    padding: space.xl,
  },
  emptyTitle: { ...type.title, color: colors.textDim },
  emptyBody: { ...type.body, color: colors.textFaint, textAlign: 'center' },
  emptyNote: { ...type.meta, color: colors.textFaint, textAlign: 'center', marginTop: space.lg },

  pin: {
    width: 42,
    height: 42,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: colors.panel,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '45deg' }],
  },
  pinSelected: { backgroundColor: colors.panelRaised, borderWidth: 3 },
  pinPerime: { opacity: 0.45 },
  pinText: { ...type.label, fontSize: 13, color: colors.text, transform: [{ rotate: '-45deg' }] },

  // Equerres de visee aux angles : l'ecran a l'air d'un panneau de
  // controle sans rien recouvrir de la carte.
  coin: { position: 'absolute', width: 22, height: 22, borderColor: colors.cyan, opacity: 0.5 },
  coinHG: { left: space.lg, borderLeftWidth: 2, borderTopWidth: 2 },
  coinHD: { right: space.lg, borderRightWidth: 2, borderTopWidth: 2 },

  topBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(16,16,24,0.94)',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    gap: space.xs,
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerRight: { ...type.label, fontSize: 10, color: colors.ember },

  outils: { position: 'absolute', right: space.lg, gap: space.xs, alignItems: 'flex-end' },
  outil: {
    backgroundColor: 'rgba(16,16,24,0.94)',
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  outilActif: { borderColor: colors.ember },
  outilTexte: { ...type.label, fontSize: 10, color: colors.text },
  outilTexteActif: { color: colors.ember },

  cards: { position: 'absolute', left: 0, right: 0, maxHeight: 150 },
  cardsContent: { paddingHorizontal: space.lg, gap: space.sm },
  card: { marginRight: space.sm },
  cardInner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  avatar: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.panelRaised,
  },
  avatarText: { ...type.label, fontSize: 15, color: colors.text },
  cardText: { flex: 1, gap: 2 },
  cardName: { ...type.title, fontSize: 19, color: colors.text },
  cardMeta: { ...type.dataSmall, color: colors.textDim },
  cardEtats: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  cardMouvement: { ...type.label, fontSize: 10, color: colors.cyan },
  cardWarn: { ...type.meta, color: colors.warn },
  cardActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  cardAction: { flex: 1, paddingVertical: space.sm, alignItems: 'center' },
  cardActionText: { ...type.label, fontSize: 10, color: colors.cyan },
  cardActionDim: { ...type.label, fontSize: 10, color: colors.textFaint },
});
