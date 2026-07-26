import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { BlackoutApp } from './src/ui/navigation';
import { colors } from './src/ui/theme/tokens';

export default function App() {
  // Polices embarquees dans le bundle : aucun telechargement au
  // demarrage, donc aucune requete reseau liee a l'affichage.
  const [fontsLoaded] = useFonts({ Anton_400Regular, SpaceMono_400Regular, SpaceMono_700Bold });

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {fontsLoaded ? (
        <BlackoutApp />
      ) : (
        <View style={styles.splash}>
          <ActivityIndicator color={colors.ember} />
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.void, justifyContent: 'center', alignItems: 'center' },
});
