// IMPORTANT : ce polyfill doit etre charge AVANT tout le reste.
// Il installe `global.crypto.getRandomValues` (SecRandomCopyBytes sur
// iOS, SecureRandom sur Android). Hermes ne fournit pas `crypto` :
// sans lui, l'app s'arrete au demarrage sur « Cannot read property
// 'getRandomValues' of undefined ».
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent appelle AppRegistry.registerComponent('main', () => App)
registerRootComponent(App);
