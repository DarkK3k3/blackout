// Tests de rendu des ecrans (react-test-renderer via jest-expo).
// Verifie que chaque ecran monte sans erreur, affiche les bonnes
// donnees et declenche les bons callbacks — y compris que le glitch
// se resout TOUJOURS sur le vrai texte (lisibilite non negociable).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { VerificationScreen } from '../screens/VerificationScreen';
import { AddContactScreen } from '../screens/AddContactScreen';
import { GlitchText } from '../components/Glitch';

/** Concatene tout le texte rendu, pour des assertions simples. */
function textOf(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType('Text' as never, { deep: true })
    .flatMap((n) => n.children.filter((c): c is string => typeof c === 'string'))
    .join(' | ');
}

describe('ChatListScreen', () => {
  const chats = [
    { id: 'a', title: 'Bob', kind: 'direct' as const, lastMessage: 'Salut !', lastAt: Date.now(), verified: true },
    { id: 'b', title: 'Soiree', kind: 'group' as const, lastMessage: null, lastAt: null, verified: false, memberCount: 5 },
  ];

  it('affiche les conversations et les indicateurs de securite', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ChatListScreen chats={chats} relayConnected meshActive={false} onOpenChat={() => {}} onAddContact={() => {}} />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('BLACKOUT');
    expect(text).toContain('Bob');
    expect(text).toContain('Soiree');
    expect(text).toContain('E2EE ACTIF');
    expect(text).toContain('RELAIS CONNECTE');
    expect(text).toContain('MESH BLE');
  });

  it('signale hors ligne quand le relais est deconnecte', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ChatListScreen chats={[]} relayConnected={false} meshActive onOpenChat={() => {}} onAddContact={() => {}} />,
      );
    });
    expect(textOf(tree)).toContain('HORS LIGNE');
  });

  it('appelle onAddContact au clic sur le bouton', () => {
    const onAddContact = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ChatListScreen chats={[]} relayConnected meshActive={false} onOpenChat={() => {}} onAddContact={onAddContact} />,
      );
    });
    const button = tree.root.findAll(
      (n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel?.includes('Ajouter'),
    )[0];
    act(() => button.props.onPress());
    expect(onAddContact).toHaveBeenCalled();
  });
});

describe('ConversationScreen', () => {
  const messages = [
    { id: '1', body: 'Salut Bob', mine: true, sentAt: Date.now(), status: 'delivered' as const },
    { id: '2', body: 'Salut Alice', mine: false, senderName: 'Bob', sentAt: Date.now(), status: 'sent' as const },
  ];

  it('affiche les messages et le statut de chiffrement', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ConversationScreen
          title="Bob"
          verified
          messages={messages}
          onSend={() => {}}
          onOpenVerification={() => {}}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('Salut Bob');
    expect(text).toContain('Salut Alice');
    expect(text).toContain('CHIFFRE');
  });

  it('envoie le texte saisi puis vide le champ', () => {
    const onSend = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ConversationScreen title="Bob" verified messages={[]} onSend={onSend} onOpenVerification={() => {}} />,
      );
    });
    const input = tree.root.findAll((n) => n.props.accessibilityLabel === 'Zone de saisie du message')[0];
    act(() => input.props.onChangeText('  coucou  '));
    const send = tree.root.findAll((n) => n.props.accessibilityLabel === 'Envoyer')[0];
    act(() => send.props.onPress());
    expect(onSend).toHaveBeenCalledWith('coucou'); // trim applique
    expect(input.props.value).toBe('');
  });

  it("n'envoie rien si le champ est vide ou blanc", () => {
    const onSend = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ConversationScreen title="Bob" verified messages={[]} onSend={onSend} onOpenVerification={() => {}} />,
      );
    });
    const input = tree.root.findAll((n) => n.props.accessibilityLabel === 'Zone de saisie du message')[0];
    act(() => input.props.onChangeText('   '));
    act(() => tree.root.findAll((n) => n.props.accessibilityLabel === 'Envoyer')[0].props.onPress());
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('GlitchText — la lisibilite prime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('se resout TOUJOURS sur le texte reel', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<GlitchText text="message dechiffre" duration={320} />);
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(textOf(tree)).toContain('message dechiffre');
  });

  it('affiche le texte immediatement quand il est desactive (historique deja lu)', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<GlitchText text="ancien message" disabled />);
    });
    expect(textOf(tree)).toContain('ancien message');
  });
});

describe('VerificationScreen', () => {
  it('affiche le code du mois, le mois et l\'empreinte', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <VerificationScreen
          contactName="Bob"
          code="9821-6195"
          yearMonth="2026-07"
          fingerprintHex="ec2a05c6be7036dd390c149d67c5cb5c"
          verified={false}
          onMarkVerified={() => {}}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('9821-6195');
    expect(text).toContain('2026-07');
    expect(text).toContain('ec2a05c6'); // empreinte groupee par 8
    expect(text).toContain('A COMPARER');
  });

  it('propose de confirmer, et masque le bouton une fois verifie', () => {
    const onMarkVerified = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <VerificationScreen
          contactName="Bob"
          code="1111-2222"
          yearMonth="2026-07"
          fingerprintHex="abcd1234"
          verified={false}
          onMarkVerified={onMarkVerified}
        />,
      );
    });
    const cta = tree.root.findAll((n) => n.props.accessibilityLabel === 'Les codes correspondent')[0];
    act(() => cta.props.onPress());
    expect(onMarkVerified).toHaveBeenCalled();

    act(() => {
      tree.update(
        <VerificationScreen
          contactName="Bob"
          code="1111-2222"
          yearMonth="2026-07"
          fingerprintHex="abcd1234"
          verified
          onMarkVerified={onMarkVerified}
        />,
      );
    });
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'Les codes correspondent')).toHaveLength(0);
    expect(textOf(tree)).toContain('VERIFIE');
  });
});

describe('AddContactScreen', () => {
  it('affiche mon QR par defaut, sans demarrer la camera', () => {
    const Scanner = jest.fn(() => null);
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <AddContactScreen
          invitePayload="blackout:1:https://x|abc|DEF" spokenCode="ABC-DEF"
          myShortFingerprint="AB12 CD34"
          Scanner={Scanner}
          onScanned={() => {}}
        />,
      );
    });
    expect(textOf(tree)).toContain('AB12 CD34');
    expect(Scanner).not.toHaveBeenCalled(); // camera eteinte tant qu'on ne scanne pas
  });

  it('monte le scanner sur l\'onglet SCANNER et remonte la valeur lue', () => {
    const onScanned = jest.fn();
    const Scanner = ({ onScanned: cb }: { onScanned: (v: string) => void }) => {
      React.useEffect(() => cb('blackout-invite:xyz'), [cb]);
      return null;
    };
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <AddContactScreen
          invitePayload="blackout:1:https://x|abc|DEF" spokenCode="ABC-DEF"
          myShortFingerprint="AB12"
          Scanner={Scanner}
          onScanned={onScanned}
        />,
      );
    });
    // findAll remonte aussi les vues hotes : on ne garde que les noeuds
    // pressables (ceux qui portent reellement le handler).
    const scanTab = tree.root.findAll(
      (n) => n.props.accessibilityRole === 'tab' && typeof n.props.onPress === 'function',
    )[1];
    act(() => scanTab.props.onPress());
    expect(onScanned).toHaveBeenCalledWith('blackout-invite:xyz');
  });
});
