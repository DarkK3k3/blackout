// navigation.tsx — assemblage des ecrans et branchement sur la couche
// d'integration (Blackout). C'est ici, et seulement ici, que l'UI
// rencontre le stockage, les sessions et le relais.

import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Blackout } from '../state/blackout';
import { openBlackoutStore } from '../storage/openDatabase';
import { nativeSignalBridge } from '../../modules/blackout-signal';
import { ChatListScreen } from './screens/ChatListScreen';
import { ConversationScreen, type ChatMessage } from './screens/ConversationScreen';
import { VerificationScreen } from './screens/VerificationScreen';
import { AddContactScreen } from './screens/AddContactScreen';
import { SettingsScreen, type TestState } from './screens/SettingsScreen';
import { LazyQrScanner } from './components/LazyQrScanner';
import { colors, fonts, space, type } from './theme/tokens';
import { RELAY_URL, MY_DISPLAY_NAME } from '../config';

type RootStackParamList = {
  Chats: undefined;
  Conversation: { contactId: string; title: string };
  Verification: { contactId: string; title: string };
  AddContact: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.ember,
    background: colors.void,
    card: colors.panel,
    text: colors.text,
    border: colors.line,
    notification: colors.ember,
  },
};

const BlackoutContext = React.createContext<Blackout | null>(null);
const useBlackout = () => {
  const app = React.useContext(BlackoutContext);
  if (!app) throw new Error('Blackout non initialise');
  return app;
};

export function BlackoutApp() {
  const [app, setApp] = React.useState<Blackout | null>(null);
  const [store, setStore] = React.useState<Awaited<ReturnType<typeof openBlackoutStore>> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [relayConnected, setRelayConnected] = React.useState(false);
  const [tick, setTick] = React.useState(0); // force le rafraichissement des listes

  React.useEffect(() => {
    let instance: Blackout | null = null;
    (async () => {
      try {
        const store = await openBlackoutStore();
        // Les reglages enregistres priment sur les valeurs de
        // compilation : changer de relais ne doit jamais imposer de
        // recompiler l'application.
        const settings = await Blackout.loadSettings(store, {
          relayUrl: RELAY_URL,
          displayName: MY_DISPLAY_NAME,
        });
        setStore(store);
        instance = new Blackout(store, nativeSignalBridge, settings.relayUrl, settings.displayName);
        await instance.init();
        await instance.startListening(
          () => setTick((t) => t + 1),
          (status) => setRelayConnected(status === 'connected'),
        );
        setApp(instance);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => instance?.stopListening();
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>DEMARRAGE IMPOSSIBLE</Text>
        <Text style={styles.errorBody}>{error}</Text>
      </View>
    );
  }
  if (!app) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ember} />
        <Text style={styles.loading}>DECHIFFREMENT DU COFFRE LOCAL…</Text>
      </View>
    );
  }

  return (
    <BlackoutContext.Provider value={app}>
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.panel },
            headerTintColor: colors.text,
            headerTitleStyle: { fontFamily: fonts.display },
            contentStyle: { backgroundColor: colors.void },
          }}
        >
          <Stack.Screen name="Chats" options={{ headerShown: false }}>
            {(props) => <ChatsContainer {...props} relayConnected={relayConnected} refreshKey={tick} />}
          </Stack.Screen>
          <Stack.Screen
            name="Conversation"
            options={({ route }) => ({ title: route.params.title })}
          >
            {(props) => <ConversationContainer {...props} refreshKey={tick} />}
          </Stack.Screen>
          <Stack.Screen name="Verification" options={{ title: 'VERIFICATION' }}>
            {(props) => <VerificationContainer {...props} />}
          </Stack.Screen>
          <Stack.Screen name="AddContact" options={{ title: 'NOUVEAU CONTACT' }}>
            {(props) => <AddContactContainer {...props} />}
          </Stack.Screen>
          <Stack.Screen name="Settings" options={{ title: 'REGLAGES' }}>
            {(props) => <SettingsContainer {...props} store={store} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </BlackoutContext.Provider>
  );
}

// ------------------------------------------------------------ conteneurs

function ChatsContainer({ navigation, relayConnected, refreshKey }: any) {
  const app = useBlackout();
  const [chats, setChats] = React.useState<Awaited<ReturnType<Blackout['listChats']>>>([]);

  React.useEffect(() => {
    const load = () => void app.listChats().then(setChats);
    load();
    return navigation.addListener('focus', load);
  }, [app, navigation, refreshKey]);

  return (
    <ChatListScreen
      chats={chats}
      relayConnected={relayConnected}
      meshActive={false} // le mesh BLE arrivera dans une prochaine etape
      onOpenChat={(id) => {
        const chat = chats.find((c) => c.id === id);
        navigation.navigate('Conversation', { contactId: id, title: chat?.title ?? 'Conversation' });
      }}
      onAddContact={() => navigation.navigate('AddContact')}
      onOpenSettings={() => navigation.navigate('Settings')}
    />
  );
}

function SettingsContainer({ navigation, store }: any) {
  const app = useBlackout();
  const [relayUrl, setRelayUrl] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [myKey, setMyKey] = React.useState('');
  const [testState, setTestState] = React.useState<TestState>({ kind: 'idle' });

  React.useEffect(() => {
    if (!store) return;
    void Blackout.loadSettings(store, { relayUrl: RELAY_URL, displayName: MY_DISPLAY_NAME }).then((s) => {
      setRelayUrl(s.relayUrl);
      setDisplayName(s.displayName);
    });
    void store.getIdentity().then((id: { publicKey: string } | null) => {
      if (id) setMyKey((id.publicKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 16).match(/.{1,4}/g) ?? []).join(' '));
    });
  }, [store]);

  return (
    <SettingsScreen
      relayUrl={relayUrl}
      displayName={displayName}
      myPublicKeyShort={myKey}
      testState={testState}
      onChangeRelayUrl={(v) => {
        setRelayUrl(v);
        setTestState({ kind: 'idle' });
      }}
      onChangeDisplayName={setDisplayName}
      onTest={() => {
        setTestState({ kind: 'testing' });
        void Blackout.testRelay(relayUrl)
          .then(() => setTestState({ kind: 'ok' }))
          .catch((e) => setTestState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }));
      }}
      onSave={() => {
        if (!store) return;
        void Blackout.saveSettings(store, { relayUrl, displayName }).then(() => {
          Alert.alert(
            'Reglages enregistres',
            'Ferme puis rouvre Blackout pour te connecter au nouveau relais.',
            [{ text: 'OK', onPress: () => navigation.goBack() }],
          );
        });
      }}
    />
  );
}

function ConversationContainer({ navigation, route, refreshKey }: any) {
  const app = useBlackout();
  const { contactId, title } = route.params;
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [verified, setVerified] = React.useState(false);
  const seen = React.useRef<Set<string>>(new Set());

  const reload = React.useCallback(async () => {
    const rows = await app.listMessages(contactId);
    // Un message jamais affiche jusqu'ici est "frais" : il declenche le
    // glitch de dechiffrement une seule fois, puis reste stable.
    setMessages(
      rows.map((m) => {
        const fresh = !m.mine && !seen.current.has(m.id);
        seen.current.add(m.id);
        return { ...m, fresh };
      }),
    );
    const v = await app.verificationFor(contactId).catch(() => null);
    if (v) setVerified(v.verified);
  }, [app, contactId]);

  React.useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  return (
    <ConversationScreen
      title={title}
      verified={verified}
      messages={messages}
      onSend={(text) => {
        void app
          .sendText(contactId, text)
          .then(reload)
          .catch((e) => Alert.alert('Envoi impossible', String(e?.message ?? e)));
      }}
      onOpenVerification={() => navigation.navigate('Verification', { contactId, title })}
    />
  );
}

function VerificationContainer({ navigation, route }: any) {
  const app = useBlackout();
  const { contactId, title } = route.params;
  const [data, setData] = React.useState<Awaited<ReturnType<Blackout['verificationFor']>> | null>(null);

  React.useEffect(() => {
    void app.verificationFor(contactId).then(setData).catch(() => setData(null));
  }, [app, contactId]);

  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.loading}>CODE INDISPONIBLE — CONTACT INCOMPLET</Text>
      </View>
    );
  }

  return (
    <VerificationScreen
      contactName={title}
      code={data.code}
      yearMonth={data.yearMonth}
      fingerprintHex={data.fingerprintHex}
      verified={data.verified}
      onMarkVerified={() => {
        void app.markVerified(contactId).then(() => {
          setData({ ...data, verified: true });
          navigation.goBack();
        });
      }}
    />
  );
}

function AddContactContainer({ navigation }: any) {
  const app = useBlackout();
  const [invite, setInvite] = React.useState<{ encoded: string; fingerprint: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void app.createInviteQr().then(({ encoded, payload }) =>
      setInvite({
        encoded,
        // empreinte courte de MON identite, pour un controle visuel rapide
        fingerprint: (payload.identityKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 16).match(/.{1,4}/g) ?? []).join(' '),
      }),
    ).catch((e) => setInviteError(e instanceof Error ? e.message : String(e)));
  }, [app]);

  // Creer une invitation exige de joindre le relais (il faut une boite
  // de reponse). Sans lui, on le dit clairement plutot que de tourner
  // dans le vide.
  if (inviteError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>RELAIS INJOIGNABLE</Text>
        <Text style={styles.errorBody}>
          Impossible de creer une invitation : le serveur relais ne repond pas.
          {'\n\n'}Verifie ta connexion, et que RELAY_URL pointe vers ton serveur
          (voir relay-server/README.md).
        </Text>
        <Text style={styles.errorDetail}>{inviteError}</Text>
      </View>
    );
  }

  if (!invite) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ember} />
      </View>
    );
  }

  return (
    <AddContactScreen
      invitePayload={invite.encoded}
      myShortFingerprint={invite.fingerprint}
      Scanner={LazyQrScanner}
      error={error}
      onScanned={(value) => {
        void app
          .acceptInviteQr(value)
          .then(() => navigation.navigate('Chats'))
          .catch((e) => setError(e instanceof Error ? e.message : String(e)));
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.void, justifyContent: 'center', alignItems: 'center', gap: space.md, padding: space.xl },
  loading: { ...type.label, color: colors.textDim, textAlign: 'center' },
  errorTitle: { ...type.title, color: colors.danger },
  errorBody: { ...type.body, color: colors.textDim, textAlign: 'center' },
  errorDetail: { ...type.dataSmall, color: colors.textFaint, textAlign: 'center' },
});
