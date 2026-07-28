// L'interactivite ne doit jamais couter la lisibilite.
//
// Ces tests verrouillent la regle du projet : une animation habille
// l'interface, elle ne la remplace pas. Un contenu qui n'apparait
// qu'apres une animation serait un contenu perdu si l'animation est
// coupee, interrompue, ou si l'appareil reduit les mouvements.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Apparition, PressionVivante, Battement } from '../components/Vivant';
import { vibrer, definirRetourActif, retourActif } from '../retour';

const mockImpact = jest.fn(async () => {});
const mockNotification = jest.fn(async () => {});

jest.mock('expo-haptics', () => ({
  impactAsync: (...a: unknown[]) => mockImpact(...(a as [])),
  notificationAsync: (...a: unknown[]) => mockNotification(...(a as [])),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

/**
 * Retrouve le Pressable REEL, pas l'element React qui l'enveloppe.
 *
 * `findAll` remonte les deux : le composant PressionVivante lui-meme
 * (dont le `onPress` est celui du test, sans le retour tactile) et le
 * Pressable interne (celui qui declenche vraiment tout). Seul le second
 * recoit `onPressIn`, ce qui permet de les distinguer.
 */
function boutonDe(arbre: renderer.ReactTestRenderer, label: string) {
  return arbre.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPressIn === 'function',
  )[0];
}

function texteDe(arbre: renderer.ReactTestRenderer): string {
  return arbre.root
    .findAllByType('Text' as never, { deep: true })
    .flatMap((n) => n.children.filter((c): c is string => typeof c === 'string'))
    .join(' | ');
}

beforeEach(() => {
  mockImpact.mockClear();
  mockNotification.mockClear();
  definirRetourActif(true);
});

describe('Apparition', () => {
  it('rend son contenu des la premiere image', () => {
    // Si le texte n'etait pas la avant la fin de l'animation, une
    // animation coupee laisserait un message invisible.
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(
        <Apparition>
          <Text>message chiffre</Text>
        </Apparition>,
      );
    });
    expect(texteDe(arbre)).toContain('message chiffre');
  });

  it('part deja de son etat final quand la duree est nulle', () => {
    // L'historique deja lu ne doit pas clignoter a chaque ouverture.
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(
        <Apparition duree={0}>
          <Text>ancien message</Text>
        </Apparition>,
      );
    });
    const vue = arbre.root.findAllByType('View' as never)[0];
    expect(vue.props.style).toBeDefined();
    expect(texteDe(arbre)).toContain('ancien message');
  });
});

describe('PressionVivante', () => {
  it('declenche l action et le retour tactile', async () => {
    const onPress = jest.fn();
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(
        <PressionVivante onPress={onPress} retour="envoi" accessibilityLabel="Envoyer">
          <Text>envoyer</Text>
        </PressionVivante>,
      );
    });
    await act(async () => boutonDe(arbre, 'Envoyer').props.onPress());

    expect(onPress).toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledWith('medium');
  });

  it('ne vibre pas quand il est desactive', async () => {
    const onPress = jest.fn();
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(
        <PressionVivante onPress={onPress} disabled retour="envoi" accessibilityLabel="Envoyer">
          <Text>envoyer</Text>
        </PressionVivante>,
      );
    });
    await act(async () => boutonDe(arbre, 'Envoyer').props.onPress());
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('accepte de n avoir aucun retour tactile', async () => {
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(
        <PressionVivante onPress={() => {}} retour={null} accessibilityLabel="Muet">
          <Text>muet</Text>
        </PressionVivante>,
      );
    });
    await act(async () => boutonDe(arbre, 'Muet').props.onPress());
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('survit a une pression sans gestionnaire', async () => {
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(
        <PressionVivante accessibilityLabel="Sans action">
          <Text>rien</Text>
        </PressionVivante>,
      );
    });
    await act(async () => boutonDe(arbre, 'Sans action').props.onPress());
    expect(texteDe(arbre)).toContain('rien');
  });
});

describe('Battement', () => {
  it('rend son contenu, actif ou non', () => {
    for (const actif of [true, false]) {
      let arbre!: renderer.ReactTestRenderer;
      act(() => {
        arbre = renderer.create(
          <Battement actif={actif}>
            <Text>halo</Text>
          </Battement>,
        );
      });
      expect(texteDe(arbre)).toContain('halo');
      act(() => arbre.unmount());
    }
  });
});

describe('vocabulaire tactile', () => {
  it('associe une intensite precise a chaque intention', async () => {
    await vibrer('toucher');
    expect(mockImpact).toHaveBeenLastCalledWith('light');
    await vibrer('envoi');
    expect(mockImpact).toHaveBeenLastCalledWith('medium');
    await vibrer('alerte');
    expect(mockImpact).toHaveBeenLastCalledWith('heavy');
    await vibrer('succes');
    expect(mockNotification).toHaveBeenLastCalledWith('success');
    await vibrer('echec');
    expect(mockNotification).toHaveBeenLastCalledWith('error');
  });

  it('se tait completement quand il est coupe', async () => {
    definirRetourActif(false);
    expect(retourActif()).toBe(false);
    await vibrer('envoi');
    await vibrer('succes');
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("n'echoue jamais si le moteur haptique est indisponible", async () => {
    // Un simulateur, un vieil appareil, un module absent : une action
    // utile ne doit JAMAIS echouer a cause d'une vibration.
    mockImpact.mockImplementationOnce(async () => {
      throw new Error('pas de moteur haptique');
    });
    await expect(vibrer('envoi')).resolves.toBeUndefined();
  });
});
