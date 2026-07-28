// Vivant — les briques qui donnent une reactivite physique a l'app.
//
// PRINCIPE, ET SA LIMITE
// ----------------------
// L'interface doit repondre au doigt et signaler ce qui vient de
// changer. Mais la regle du projet ne bouge pas : l'esthetique habille
// l'interface, elle ne la sacrifie jamais. Concretement :
//
//  - aucune animation ne retarde une action : le retour visuel
//    accompagne, il ne precede pas ;
//  - rien ne boucle en permanence SAUF pour dire quelque chose de vrai
//    (une position en direct pulse ; une position perimee, non) ;
//  - le contenu est rendu immediatement, a sa place definitive : une
//    animation ratee ou coupee laisse une interface lisible, jamais un
//    ecran vide.

import React from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { vibrerVite, type Retour } from '../retour';

/**
 * Pressable qui s'enfonce sous le doigt et emet un retour tactile.
 *
 * L'echelle descend a 0,96 : assez pour etre senti, trop peu pour
 * deplacer le texte de facon genante.
 */
export function PressionVivante({
  children,
  retour = 'toucher',
  style,
  onPress,
  disabled,
  ...rest
}: PressableProps & {
  children: React.ReactNode;
  /** Retour tactile associe. `null` pour aucun. */
  retour?: Retour | null;
  style?: ViewStyle | ViewStyle[];
}) {
  const echelle = React.useRef(new Animated.Value(1)).current;

  const animer = React.useCallback(
    (vers: number) => {
      Animated.spring(echelle, {
        toValue: vers,
        useNativeDriver: true,
        speed: 40,
        bounciness: 6,
      }).start();
    },
    [echelle],
  );

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        animer(0.96);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animer(1);
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        // Le retour tactile part AVANT le travail declenche : c'est ce
        // qui donne l'impression que l'app repond instantanement.
        if (retour && !disabled) vibrerVite(retour);
        onPress?.(e);
      }}
    >
      <Animated.View style={[style as ViewStyle, { transform: [{ scale: echelle }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Fait entrer un element : opacite et leger deplacement.
 *
 * Le contenu est rendu des la premiere image ; seule sa presentation
 * est animee. Si l'animation est interrompue, il reste visible.
 */
export function Apparition({
  children,
  depuis = 'bas',
  duree = 220,
  style,
}: {
  children: React.ReactNode;
  depuis?: 'bas' | 'gauche' | 'droite';
  /** 0 = pas d'animation du tout : l'element est a sa place d'emblee. */
  duree?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // Duree nulle : on part deja de l'etat final. Sans ca, l'historique
  // deja lu clignoterait a chaque ouverture de la conversation.
  const avancement = React.useRef(new Animated.Value(duree === 0 ? 1 : 0)).current;

  React.useEffect(() => {
    if (duree === 0) {
      avancement.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(avancement, {
      toValue: 1,
      duration: duree,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [avancement, duree]);

  const decalage = avancement.interpolate({
    inputRange: [0, 1],
    outputRange: [depuis === 'bas' ? 14 : depuis === 'gauche' ? -18 : 18, 0],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: avancement,
          transform: depuis === 'bas' ? [{ translateY: decalage }] : [{ translateX: decalage }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Halo qui bat lentement. Reserve a ce qui est VRAI et vivant : une
 * position recue a l'instant, une connexion active. Un decor qui bat
 * en permanence n'informe de rien et fatigue.
 */
export function Battement({
  children,
  actif = true,
  periode = 1800,
  style,
}: {
  children: React.ReactNode;
  actif?: boolean;
  periode?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const valeur = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!actif) {
      valeur.setValue(0);
      return undefined;
    }
    const boucle = Animated.loop(
      Animated.sequence([
        Animated.timing(valeur, {
          toValue: 1,
          duration: periode / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(valeur, {
          toValue: 0,
          duration: periode / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    boucle.start();
    // Arret a la sortie de l'ecran : une boucle oubliee tourne pour
    // rien et use la batterie.
    return () => boucle.stop();
  }, [actif, periode, valeur]);

  const echelle = valeur.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const opacite = valeur.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <Animated.View style={[style, { opacity: opacite, transform: [{ scale: echelle }] }]}>
      {children}
    </Animated.View>
  );
}
