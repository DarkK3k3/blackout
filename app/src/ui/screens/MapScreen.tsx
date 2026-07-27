// MapScreen — carte des positions partagees.
//
// Difference de fond avec les applications de localisation familiale
// grand public : ici, le serveur ne voit RIEN. Les positions voyagent
// chiffrees dans la meme session que les messages, et ne sont lisibles
// que par la personne a qui tu les envoies.
//
// L'ecran affiche en permanence QUI te voit et jusqu'a quand : un
// partage de position qu'on oublie est le vrai danger de ce genre de
// fonction.

import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import { CutFrame } from '../components/CutFrame';
import { ActionButton, StatusBadge } from '../components/Primitives';
import { colors, space, type } from '../theme/tokens';

export interface SharedLocation {
  contactId: string;
  displayName: string;
  verified: boolean;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  measuredAt: number;
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
  permissionGranted: boolean;
  onRequestPermission: () => void;
  onStopSharing: (contactId: string) => void;
  onForget: (contactId: string) => void;
}

function ageLisible(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return `il y a ${Math.floor(heures / 24)} j`;
}

function resteLisible(until: number): string {
  const minutes = Math.max(0, Math.round((until - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function MapScreen({
  locations,
  outgoing,
  permissionGranted,
  onRequestPermission,
  onStopSharing,
  onForget,
}: MapScreenProps) {
  const region = React.useMemo(() => {
    if (locations.length === 0) return undefined;
    const lats = locations.map((l) => l.latitude);
    const lons = locations.map((l) => l.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.02, (maxLon - minLon) * 1.6),
    };
  }, [locations]);

  return (
    <View style={styles.root}>
      {locations.length > 0 ? (
        <MapView
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={region}
          userInterfaceStyle="dark"
          showsUserLocation={permissionGranted}
        >
          {locations.map((l) => (
            <React.Fragment key={l.contactId}>
              <Marker
                coordinate={{ latitude: l.latitude, longitude: l.longitude }}
                title={l.displayName}
                description={ageLisible(l.measuredAt)}
                pinColor={l.verified ? colors.cyan : colors.warn}
              />
              {l.accuracyM ? (
                // Le cercle rend la PRECISION visible : une position a
                // 500 m pres ne doit pas ressembler a une position exacte.
                <Circle
                  center={{ latitude: l.latitude, longitude: l.longitude }}
                  radius={l.accuracyM}
                  strokeColor={colors.cyan}
                  fillColor="rgba(0,229,255,0.10)"
                  strokeWidth={1}
                />
              ) : null}
            </React.Fragment>
          ))}
        </MapView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>AUCUNE POSITION PARTAGEE</Text>
          <Text style={styles.emptyBody}>
            Personne ne partage sa position avec toi pour l'instant. Ouvre une
            conversation et touche PARTAGER MA POSITION pour commencer.
          </Text>
          {!permissionGranted ? (
            <ActionButton label="Autoriser la localisation" onPress={onRequestPermission} />
          ) : null}
        </View>
      )}

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {outgoing.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>QUI PEUT ME VOIR</Text>
            {outgoing.map((o) => (
              <CutFrame key={o.contactId} accent={colors.ember} corners={['tl']} style={styles.row}>
                <View style={styles.rowInner}>
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{o.displayName}</Text>
                    <Text style={styles.meta}>encore {resteLisible(o.until)}</Text>
                  </View>
                  <Pressable
                    onPress={() => onStopSharing(o.contactId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Arreter le partage avec ${o.displayName}`}
                    style={styles.stopButton}
                  >
                    <Text style={styles.stopLabel}>ARRETER</Text>
                  </Pressable>
                </View>
              </CutFrame>
            ))}
          </>
        ) : null}

        {locations.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>POSITIONS RECUES</Text>
            {locations.map((l) => (
              <CutFrame key={l.contactId} accent={colors.line} corners={['tl']} style={styles.row}>
                <View style={styles.rowInner}>
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{l.displayName}</Text>
                    <Text style={styles.meta}>
                      {ageLisible(l.measuredAt)}
                      {l.accuracyM ? ` · a ${Math.round(l.accuracyM)} m pres` : ''}
                    </Text>
                    <StatusBadge
                      label={l.verified ? 'contact verifie' : 'non verifie'}
                      color={l.verified ? colors.cyan : colors.warn}
                      active={l.verified}
                    />
                  </View>
                  <Pressable
                    onPress={() => onForget(l.contactId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Oublier la position de ${l.displayName}`}
                    style={styles.stopButton}
                  >
                    <Text style={styles.forgetLabel}>OUBLIER</Text>
                  </Pressable>
                </View>
              </CutFrame>
            ))}
          </>
        ) : null}

        <Text style={styles.note}>
          Les positions sont chiffrees comme tes messages : le serveur relais
          ne peut pas les lire. Aucun historique n'est conserve — seule la
          derniere position de chacun.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  map: { height: '52%' },
  empty: { height: '40%', justifyContent: 'center', alignItems: 'center', gap: space.md, padding: space.xl },
  emptyTitle: { ...type.title, color: colors.textDim, textAlign: 'center' },
  emptyBody: { ...type.body, color: colors.textFaint, textAlign: 'center' },
  panel: { flex: 1 },
  panelContent: { padding: space.lg, gap: space.sm },
  sectionLabel: { ...type.label, color: colors.textDim, marginTop: space.sm },
  row: { marginBottom: space.xs },
  rowInner: { flexDirection: 'row', alignItems: 'center', padding: space.md, gap: space.md },
  rowText: { flex: 1, gap: 2 },
  name: { ...type.title, fontSize: 18, color: colors.text },
  meta: { ...type.dataSmall, color: colors.textDim },
  stopButton: { paddingVertical: space.sm, paddingHorizontal: space.md },
  stopLabel: { ...type.label, fontSize: 11, color: colors.ember },
  forgetLabel: { ...type.label, fontSize: 11, color: colors.textDim },
  note: { ...type.meta, color: colors.textFaint, lineHeight: 16, marginTop: space.md },
});
