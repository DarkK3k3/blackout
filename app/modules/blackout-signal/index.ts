// Point d'entree du module natif BlackoutSignal.
// Expose le pont libsignal (Kotlin/Swift) sous le contrat SignalBridge.
// Dans les tests Jest, ne pas importer ce fichier : utiliser
// src/crypto/testutils/nodeSignalBridge.ts (bindings Node officiels).

import { requireNativeModule } from 'expo-modules-core';
import type { SignalBridge } from '../../src/crypto/signalBridge.types';

export const nativeSignalBridge = requireNativeModule<SignalBridge>('BlackoutSignal');
