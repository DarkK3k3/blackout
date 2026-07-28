// IMPORTANT : ce polyfill doit etre charge AVANT tout le reste.
// Il installe `global.crypto.getRandomValues` (SecRandomCopyBytes sur
// iOS, SecureRandom sur Android). Hermes ne fournit pas `crypto` :
// sans lui, l'app s'arrete au demarrage sur « Cannot read property
// 'getRandomValues' of undefined ».
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

// La tache de partage de position doit etre DEFINIE au chargement du
// bundle, avant tout rendu. Quand iOS reveille l'app en arriere-plan
// pour livrer une position, aucune vue n'est montee : si la definition
// dependait d'un composant, la tache n'existerait pas au moment ou le
// systeme l'appelle.
import './src/ui/backgroundLocation';

import App from './App';

// registerRootComponent appelle AppRegistry.registerComponent('main', () => App)
registerRootComponent(App);
