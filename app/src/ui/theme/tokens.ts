// tokens.ts — systeme de design DedSec de Blackout.
// ------------------------------------------------------------------
// Regle directrice : le fond est sombre et NEUTRE, les neons sont des
// ACCENTS rares (boutons d'action, badges d'etat, indicateurs de
// chiffrement). Le texte des messages reste blanc cassé, lisible :
// l'esthetique habille l'interface, elle ne la sacrifie jamais.
//
// Deux registres typographiques, contraste identitaire DedSec :
//   display (Anton)      -> titres, branding, boutons : condensé, pochoir
//   mono (Space Mono)    -> UNIQUEMENT donnees techniques : empreintes,
//                           codes de verification, ids, logs
//   body (systeme)       -> messages et texte courant, pour la lisibilite
// ------------------------------------------------------------------

export const colors = {
  // fonds
  void: '#07070A', // fond d'ecran
  panel: '#101018', // cartes, panneaux
  panelRaised: '#16161F', // elements survoles / actifs
  line: '#25252F', // filets, bordures inertes

  // texte
  text: '#ECECF1', // messages, texte courant
  textDim: '#8A8A9A', // metadonnees, horodatages
  textFaint: '#4C4C5C', // placeholders

  // trio neon DedSec — a doser
  ember: '#FF3B1F', // orange/rouge electrique : action primaire, alerte
  cyan: '#00E5FF', // cyan : chiffrement actif, information
  magenta: '#FF2BD6', // magenta : mesh Bluetooth, etats secondaires

  // etats
  ok: '#00E5FF',
  warn: '#FFB300',
  danger: '#FF3B1F',
} as const;

export const fonts = {
  display: 'Anton_400Regular', // titres, branding, libelles de boutons
  mono: 'SpaceMono_700Bold', // donnees techniques uniquement
  monoRegular: 'SpaceMono_400Regular',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Taille du biseau des cadres a coins coupes (pas d'arrondis mous). */
export const CUT = 12;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 34, letterSpacing: 1.5 },
  title: { fontFamily: fonts.display, fontSize: 22, letterSpacing: 1.2 },
  label: { fontFamily: fonts.display, fontSize: 13, letterSpacing: 1.6 },
  body: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 11, letterSpacing: 0.4 },
  data: { fontFamily: fonts.mono, fontSize: 15, letterSpacing: 1 },
  dataSmall: { fontFamily: fonts.monoRegular, fontSize: 11, letterSpacing: 0.6 },
} as const;
