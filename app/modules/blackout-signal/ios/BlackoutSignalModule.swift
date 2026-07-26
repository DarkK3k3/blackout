import ExpoModulesCore
import LibSignalClient

// ------------------------------------------------------------------
// Pont Expo -> LibSignalClient (lib Swift officielle de Signal).
// Implemente le contrat SignalBridge de l'app (signalBridge.types.ts),
// strictement equivalent au module Kotlin et a l'adaptateur Node des
// tests (meme coeur Rust dans les trois cas).
//
// Modele "coeur fonctionnel" : aucun etat conserve ici. Records
// serialises (base64) en entree, records mis a jour en sortie ;
// persistance cote JS (SQLCipher). Les stores in-memory acceptent
// toute identite : le pinning est fait par la couche app (QR).
// ------------------------------------------------------------------

struct BundleParam: Record {
  @Field var registrationId: Int = 0
  @Field var deviceId: Int = 1
  @Field var identityKey: String = ""
  @Field var signedPreKeyId: Int = 0
  @Field var signedPreKeyPublic: String = ""
  @Field var signedPreKeySignature: String = ""
  @Field var preKeyId: Int? = nil
  @Field var preKeyPublic: String? = nil
  @Field var kyberPreKeyId: Int = 0
  @Field var kyberPreKeyPublic: String = ""
  @Field var kyberPreKeySignature: String = ""
}

struct LocalPreKeysParam: Record {
  @Field var signedPreKeyRecord: String = ""
  @Field var kyberPreKeyRecord: String = ""
  @Field var preKeyRecords: [String] = []
}

enum BlackoutSignalError: Error {
  case badBase64(String)
}

private func unb64(_ s: String) throws -> Data {
  guard let data = Data(base64Encoded: s) else { throw BlackoutSignalError.badBase64(s) }
  return data
}

private func b64(_ d: Data) -> String { d.base64EncodedString() }

private func makeStore(_ identityRecord: String, _ registrationId: Int) throws -> InMemorySignalProtocolStore {
  let identity = try IdentityKeyPair(bytes: unb64(identityRecord))
  return InMemorySignalProtocolStore(identity: identity, registrationId: UInt32(registrationId))
}

private func loadSessionB64(_ store: InMemorySignalProtocolStore, _ remote: ProtocolAddress) throws -> String {
  guard let session = try store.loadSession(for: remote, context: NullContext()) else {
    throw SignalError.sessionNotFound("session absente apres l'operation")
  }
  return b64(session.serialize())
}

public class BlackoutSignalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BlackoutSignal")

    AsyncFunction("generateIdentityKeyPair") { () -> [String: Any] in
      let keyPair = IdentityKeyPair.generate()
      // 14 bits non nuls, meme convention que KeyHelper de libsignal
      let registrationId = Int.random(in: 1...16380)
      return [
        "identityRecord": b64(keyPair.serialize()),
        "publicKey": b64(keyPair.publicKey.serialize()),
        "registrationId": registrationId,
      ]
    }

    AsyncFunction("generatePreKeys") {
      (identityRecord: String, signedPreKeyId: Int, preKeyStartId: Int, preKeyCount: Int, kyberPreKeyId: Int) -> [String: Any] in
      let identity = try IdentityKeyPair(bytes: unb64(identityRecord))
      let now = UInt64(Date().timeIntervalSince1970 * 1000)

      let spkPrivate = PrivateKey.generate()
      let spkSignature = identity.privateKey.generateSignature(message: spkPrivate.publicKey.serialize())
      let signedPreKey = try SignedPreKeyRecord(
        id: UInt32(signedPreKeyId), timestamp: now, privateKey: spkPrivate, signature: spkSignature)

      var preKeys: [[String: Any]] = []
      for i in 0..<preKeyCount {
        let priv = PrivateKey.generate()
        let record = try PreKeyRecord(id: UInt32(preKeyStartId + i), privateKey: priv)
        preKeys.append([
          "id": preKeyStartId + i,
          "record": b64(record.serialize()),
          "publicKey": b64(priv.publicKey.serialize()),
        ])
      }

      let kemPair = KEMKeyPair.generate()
      let kyberSignature = identity.privateKey.generateSignature(message: kemPair.publicKey.serialize())
      let kyberPreKey = try KyberPreKeyRecord(
        id: UInt32(kyberPreKeyId), timestamp: now, keyPair: kemPair, signature: kyberSignature)

      return [
        "signedPreKey": [
          "id": signedPreKeyId,
          "record": b64(signedPreKey.serialize()),
          "publicKey": b64(spkPrivate.publicKey.serialize()),
          "signature": b64(spkSignature),
        ],
        "preKeys": preKeys,
        "kyberPreKey": [
          "id": kyberPreKeyId,
          "record": b64(kyberPreKey.serialize()),
          "publicKey": b64(kemPair.publicKey.serialize()),
          "signature": b64(kyberSignature),
        ],
      ]
    }

    AsyncFunction("processPreKeyBundle") {
      (identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String, bundle: BundleParam) -> [String: Any] in
      let store = try makeStore(identityRecord, registrationId)
      let remote = try ProtocolAddress(name: remoteAddress, deviceId: UInt32(bundle.deviceId))
      let local = try ProtocolAddress(name: localAddress, deviceId: 1)

      let identityKey = try IdentityKey(bytes: unb64(bundle.identityKey))
      let signedPrekey = try PublicKey(unb64(bundle.signedPreKeyPublic))
      let kyberPrekey = try KEMPublicKey(unb64(bundle.kyberPreKeyPublic))

      let preKeyBundle: PreKeyBundle
      if let preKeyId = bundle.preKeyId, let preKeyPublic = bundle.preKeyPublic {
        preKeyBundle = try PreKeyBundle(
          registrationId: UInt32(bundle.registrationId),
          deviceId: UInt32(bundle.deviceId),
          prekeyId: UInt32(preKeyId),
          prekey: try PublicKey(unb64(preKeyPublic)),
          signedPrekeyId: UInt32(bundle.signedPreKeyId),
          signedPrekey: signedPrekey,
          signedPrekeySignature: try unb64(bundle.signedPreKeySignature),
          identity: identityKey,
          kyberPrekeyId: UInt32(bundle.kyberPreKeyId),
          kyberPrekey: kyberPrekey,
          kyberPrekeySignature: try unb64(bundle.kyberPreKeySignature))
      } else {
        preKeyBundle = try PreKeyBundle(
          registrationId: UInt32(bundle.registrationId),
          deviceId: UInt32(bundle.deviceId),
          signedPrekeyId: UInt32(bundle.signedPreKeyId),
          signedPrekey: signedPrekey,
          signedPrekeySignature: try unb64(bundle.signedPreKeySignature),
          identity: identityKey,
          kyberPrekeyId: UInt32(bundle.kyberPreKeyId),
          kyberPrekey: kyberPrekey,
          kyberPrekeySignature: try unb64(bundle.kyberPreKeySignature))
      }

      try processPreKeyBundle(
        preKeyBundle, for: remote, ourAddress: local,
        sessionStore: store, identityStore: store, context: NullContext())

      return ["session": try loadSessionB64(store, remote)]
    }

    AsyncFunction("encrypt") {
      (identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String, session: String, plaintext: String) -> [String: Any] in
      let store = try makeStore(identityRecord, registrationId)
      let remote = try ProtocolAddress(name: remoteAddress, deviceId: 1)
      let local = try ProtocolAddress(name: localAddress, deviceId: 1)
      try store.storeSession(SessionRecord(bytes: unb64(session)), for: remote, context: NullContext())

      let message = try signalEncrypt(
        message: unb64(plaintext), for: remote, localAddress: local,
        sessionStore: store, identityStore: store, context: NullContext())

      return [
        "type": Int(message.messageType.rawValue),
        "body": b64(message.serialize()),
        "session": try loadSessionB64(store, remote),
      ]
    }

    AsyncFunction("decryptWhisper") {
      (identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String, session: String, body: String) -> [String: Any] in
      let store = try makeStore(identityRecord, registrationId)
      let remote = try ProtocolAddress(name: remoteAddress, deviceId: 1)
      let local = try ProtocolAddress(name: localAddress, deviceId: 1)
      try store.storeSession(SessionRecord(bytes: unb64(session)), for: remote, context: NullContext())

      let message = try SignalMessage(bytes: unb64(body))
      let plaintext = try signalDecrypt(
        message: message, from: remote, to: local,
        sessionStore: store, identityStore: store, context: NullContext())

      return [
        "plaintext": b64(plaintext),
        "session": try loadSessionB64(store, remote),
      ]
    }

    AsyncFunction("decryptPreKey") {
      (identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String,
       session: String?, body: String, localPreKeys: LocalPreKeysParam) -> [String: Any] in
      let store = try makeStore(identityRecord, registrationId)
      let remote = try ProtocolAddress(name: remoteAddress, deviceId: 1)
      let local = try ProtocolAddress(name: localAddress, deviceId: 1)
      if let session = session {
        try store.storeSession(SessionRecord(bytes: unb64(session)), for: remote, context: NullContext())
      }

      let spk = try SignedPreKeyRecord(bytes: unb64(localPreKeys.signedPreKeyRecord))
      try store.storeSignedPreKey(spk, id: spk.id, context: NullContext())
      let kyber = try KyberPreKeyRecord(bytes: unb64(localPreKeys.kyberPreKeyRecord))
      try store.storeKyberPreKey(kyber, id: kyber.id, context: NullContext())
      for recordB64 in localPreKeys.preKeyRecords {
        let record = try PreKeyRecord(bytes: unb64(recordB64))
        try store.storePreKey(record, id: record.id, context: NullContext())
      }

      let message = try PreKeySignalMessage(bytes: unb64(body))
      let plaintext = try signalDecryptPreKey(
        message: message, from: remote, localAddress: local,
        sessionStore: store, identityStore: store,
        preKeyStore: store, signedPreKeyStore: store, kyberPreKeyStore: store,
        context: NullContext())

      return [
        "plaintext": b64(plaintext),
        "session": try loadSessionB64(store, remote),
        "usedPreKeyId": try message.preKeyId().map { Int($0) } as Any,
      ]
    }
  }
}
