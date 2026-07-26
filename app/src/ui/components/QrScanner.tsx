// QrScanner — camera + lecture de QR code.
//
// POURQUOI expo-camera ET PLUS vision-camera
// ------------------------------------------
// react-native-vision-camera v5 repose sur Nitro, une architecture
// native tres recente. Dans ce projet, elle a coute cher : son import
// au demarrage etait suspect dans un crash, son plugin de config est
// absent du paquet, son API a entierement change entre v4 et v5, et au
// final la camera ne s'activait pas sur l'appareil malgre
// l'autorisation accordee.
//
// expo-camera est maintenu par Expo, integre au meme ecosysteme que le
// reste du projet, et sait lire les QR codes nativement. Moins
// d'options avancees — dont on n'a aucun usage ici : on lit un QR, un
// point c'est tout.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ActionButton } from './Primitives';
import { colors, space, type } from '../theme/tokens';

export function QrScanner({ onScanned }: { onScanned: (value: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = React.useRef(false);

  if (!permission) {
    // L'etat de l'autorisation n'est pas encore connu.
    return <View style={styles.fallback} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.text}>
          {permission.canAskAgain
            ? "Blackout a besoin de la camera pour lire le QR code d'invitation."
            : "L'acces a la camera a ete refuse. Autorise-le dans Reglages > Blackout, ou saisis le code a la main dans l'onglet SAISIR."}
        </Text>
        {permission.canAskAgain ? (
          <ActionButton label="Autoriser la camera" onPress={() => void requestPermission()} />
        ) : null}
      </View>
    );
  }

  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={({ data }) => {
        // Un seul scan traite : la camera continue de filmer, on ne
        // veut pas rejouer l'ajout de contact en boucle.
        if (handled.current || !data) return;
        handled.current = true;
        onScanned(data);
      }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  text: { ...type.body, color: colors.textDim, textAlign: 'center' },
});
