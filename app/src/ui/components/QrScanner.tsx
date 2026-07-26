// QrScanner — camera + decodage QR (react-native-vision-camera v5).
//
// Isole dans son propre fichier : importe uniquement par l'ecran
// d'ajout de contact, et monte seulement quand l'onglet SCANNER est
// actif, pour que la camera ne tourne jamais inutilement.
//
// API v5 (Nitro) : la detection de codes passe par un "object output"
// declare sur la camera (useObjectOutput), plus par un codeScanner.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useObjectOutput,
  usePreviewOutput,
  isScannedCode,
} from 'react-native-vision-camera';
import { colors, space, type } from '../theme/tokens';

export function QrScanner({ onScanned }: { onScanned: (value: string) => void }) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission, canRequestPermission } = useCameraPermission();
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (!hasPermission && canRequestPermission) void requestPermission();
  }, [hasPermission, canRequestPermission, requestPermission]);

  const previewOutput = usePreviewOutput();
  const objectOutput = useObjectOutput({
    types: ['qr'],
    onObjectsScanned: (objects) => {
      // Un seul scan traite : evite de rejouer l'ajout de contact
      // pendant que la camera continue de filmer le meme QR.
      if (handled.current) return;
      for (const object of objects) {
        if (isScannedCode(object) && object.value) {
          handled.current = true;
          onScanned(object.value);
          return;
        }
      }
    },
  });

  const outputs = React.useMemo(() => [previewOutput, objectOutput], [previewOutput, objectOutput]);

  if (!hasPermission) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.text}>Autorise l'acces a la camera pour scanner un QR code.</Text>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.text}>Aucune camera disponible sur cet appareil.</Text>
      </View>
    );
  }

  return <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={outputs} />;
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', padding: space.xl },
  text: { ...type.body, color: colors.textDim, textAlign: 'center' },
});
