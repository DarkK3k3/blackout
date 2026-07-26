package expo.modules.blackoutsignal

// ------------------------------------------------------------------
// Pont Expo -> libsignal officiel (org.signal:libsignal-android).
// Implemente le contrat SignalBridge de l'app (signalBridge.types.ts).
//
// Modele "coeur fonctionnel" : AUCUN etat conserve ici. Chaque appel
// recoit les records serialises (base64), reconstruit des stores
// in-memory libsignal le temps de l'operation, et retourne les
// records mis a jour. La persistance appartient a la couche JS
// (SQLCipher). Les cles privees ne quittent jamais l'appareil : les
// records ne transitent que sur le pont JS<->natif local.
//
// La confiance dans les identites n'est PAS decidee ici (les stores
// in-memory acceptent tout) : le pinning est fait par la couche app
// via la verification QR out-of-band.
// ------------------------------------------------------------------

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.security.SecureRandom
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair
import org.signal.libsignal.protocol.SessionBuilder
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.kem.KEMKeyPair
import org.signal.libsignal.protocol.kem.KEMKeyType
import org.signal.libsignal.protocol.kem.KEMPublicKey
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyBundle
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

class BundleParam : Record {
  @Field var registrationId: Int = 0
  @Field var deviceId: Int = 1
  @Field var identityKey: String = ""
  @Field var signedPreKeyId: Int = 0
  @Field var signedPreKeyPublic: String = ""
  @Field var signedPreKeySignature: String = ""
  @Field var preKeyId: Int? = null
  @Field var preKeyPublic: String? = null
  @Field var kyberPreKeyId: Int = 0
  @Field var kyberPreKeyPublic: String = ""
  @Field var kyberPreKeySignature: String = ""
}

class LocalPreKeysParam : Record {
  @Field var signedPreKeyRecord: String = ""
  @Field var kyberPreKeyRecord: String = ""
  @Field var preKeyRecords: List<String> = emptyList()
}

private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
private fun unb64(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)

class BlackoutSignalModule : Module() {

  private fun makeStore(identityRecord: String, registrationId: Int): InMemorySignalProtocolStore {
    val identity = IdentityKeyPair(unb64(identityRecord))
    return InMemorySignalProtocolStore(identity, registrationId)
  }

  override fun definition() = ModuleDefinition {
    Name("BlackoutSignal")

    AsyncFunction("generateIdentityKeyPair") {
      val keyPair = IdentityKeyPair.generate()
      // 14 bits non nuls, meme convention que KeyHelper de libsignal
      val registrationId = SecureRandom().nextInt(16380) + 1
      mapOf(
        "identityRecord" to b64(keyPair.serialize()),
        "publicKey" to b64(keyPair.publicKey.serialize()),
        "registrationId" to registrationId,
      )
    }

    AsyncFunction("generatePreKeys") {
        identityRecord: String, signedPreKeyId: Int, preKeyStartId: Int, preKeyCount: Int, kyberPreKeyId: Int ->
      val identity = IdentityKeyPair(unb64(identityRecord))
      val now = System.currentTimeMillis()

      val spkPair = ECKeyPair.generate()
      val spkSignature = identity.privateKey.calculateSignature(spkPair.publicKey.serialize())
      val signedPreKey = SignedPreKeyRecord(signedPreKeyId, now, spkPair, spkSignature)

      val preKeys = (0 until preKeyCount).map { i ->
        val pair = ECKeyPair.generate()
        val record = PreKeyRecord(preKeyStartId + i, pair)
        mapOf(
          "id" to preKeyStartId + i,
          "record" to b64(record.serialize()),
          "publicKey" to b64(pair.publicKey.serialize()),
        )
      }

      val kemPair = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
      val kyberSignature = identity.privateKey.calculateSignature(kemPair.publicKey.serialize())
      val kyberPreKey = KyberPreKeyRecord(kyberPreKeyId, now, kemPair, kyberSignature)

      mapOf(
        "signedPreKey" to mapOf(
          "id" to signedPreKeyId,
          "record" to b64(signedPreKey.serialize()),
          "publicKey" to b64(spkPair.publicKey.serialize()),
          "signature" to b64(spkSignature),
        ),
        "preKeys" to preKeys,
        "kyberPreKey" to mapOf(
          "id" to kyberPreKeyId,
          "record" to b64(kyberPreKey.serialize()),
          "publicKey" to b64(kemPair.publicKey.serialize()),
          "signature" to b64(kyberSignature),
        ),
      )
    }

    AsyncFunction("processPreKeyBundle") {
        identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String, bundle: BundleParam ->
      val store = makeStore(identityRecord, registrationId)
      val remote = SignalProtocolAddress(remoteAddress, bundle.deviceId)
      val local = SignalProtocolAddress(localAddress, 1)

      val preKeyBundle = PreKeyBundle(
        bundle.registrationId,
        bundle.deviceId,
        bundle.preKeyId ?: PreKeyBundle.NULL_PRE_KEY_ID,
        bundle.preKeyPublic?.let { ECPublicKey(unb64(it)) },
        bundle.signedPreKeyId,
        ECPublicKey(unb64(bundle.signedPreKeyPublic)),
        unb64(bundle.signedPreKeySignature),
        IdentityKey(unb64(bundle.identityKey)),
        bundle.kyberPreKeyId,
        KEMPublicKey(unb64(bundle.kyberPreKeyPublic)),
        unb64(bundle.kyberPreKeySignature),
      )

      SessionBuilder(store, remote, local).process(preKeyBundle)
      mapOf("session" to b64(store.loadSession(remote).serialize()))
    }

    AsyncFunction("encrypt") {
        identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String, session: String, plaintext: String ->
      val store = makeStore(identityRecord, registrationId)
      val remote = SignalProtocolAddress(remoteAddress, 1)
      val local = SignalProtocolAddress(localAddress, 1)
      store.storeSession(remote, SessionRecord(unb64(session)))

      val message = SessionCipher(store, local, remote).encrypt(unb64(plaintext))
      mapOf(
        "type" to message.type,
        "body" to b64(message.serialize()),
        "session" to b64(store.loadSession(remote).serialize()),
      )
    }

    AsyncFunction("decryptWhisper") {
        identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String, session: String, body: String ->
      val store = makeStore(identityRecord, registrationId)
      val remote = SignalProtocolAddress(remoteAddress, 1)
      val local = SignalProtocolAddress(localAddress, 1)
      store.storeSession(remote, SessionRecord(unb64(session)))

      val plaintext = SessionCipher(store, local, remote).decrypt(SignalMessage(unb64(body)))
      mapOf(
        "plaintext" to b64(plaintext),
        "session" to b64(store.loadSession(remote).serialize()),
      )
    }

    AsyncFunction("decryptPreKey") {
        identityRecord: String, registrationId: Int, localAddress: String, remoteAddress: String,
        session: String?, body: String, localPreKeys: LocalPreKeysParam ->
      val store = makeStore(identityRecord, registrationId)
      val remote = SignalProtocolAddress(remoteAddress, 1)
      val local = SignalProtocolAddress(localAddress, 1)
      if (session != null) store.storeSession(remote, SessionRecord(unb64(session)))

      val spk = SignedPreKeyRecord(unb64(localPreKeys.signedPreKeyRecord))
      store.storeSignedPreKey(spk.id, spk)
      val kyber = KyberPreKeyRecord(unb64(localPreKeys.kyberPreKeyRecord))
      store.storeKyberPreKey(kyber.id, kyber)
      for (recordB64 in localPreKeys.preKeyRecords) {
        val record = PreKeyRecord(unb64(recordB64))
        store.storePreKey(record.id, record)
      }

      val message = PreKeySignalMessage(unb64(body))
      val plaintext = SessionCipher(store, local, remote).decrypt(message)
      mapOf(
        "plaintext" to b64(plaintext),
        "session" to b64(store.loadSession(remote).serialize()),
        "usedPreKeyId" to if (message.preKeyId.isPresent) message.preKeyId.get() else null,
      )
    }
  }
}
