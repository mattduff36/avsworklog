package com.squiresapp.yardkiosk

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID

data class AttestedKey(
    val alias: String,
    val publicKeySpki: String,
    val certificateChain: List<String>,
    val securityLevel: String,
)

class DeviceKeyStore(
    private val identityStore: DeviceIdentityStore,
) {
    private val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    fun hasKey(alias: String?): Boolean {
        return !alias.isNullOrBlank() && keyStore.containsAlias(alias)
    }

    fun clearIdentity() {
        identityStore.activeKeyAlias?.let(::deleteKey)
        identityStore.pendingKeyAlias?.let(::deleteKey)
        identityStore.clear()
    }

    fun createAttestedKey(challenge: ByteArray): AttestedKey {
        require(challenge.size == CHALLENGE_BYTES) {
            "The attestation challenge must be exactly $CHALLENGE_BYTES bytes"
        }

        identityStore.pendingKeyAlias?.let(::deleteKey)
        val alias = "avs-yard-kiosk-${UUID.randomUUID()}"
        val strongBoxRequested = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
        try {
            generate(alias, challenge, strongBoxRequested)
        } catch (_: StrongBoxUnavailableException) {
            generate(alias, challenge, false)
        }

        val privateKey = requireNotNull(keyStore.getKey(alias, null)) {
            "Android Keystore did not return the generated private key"
        }
        val keyInfo = KeyFactory.getInstance(
            privateKey.algorithm,
            ANDROID_KEYSTORE,
        ).getKeySpec(privateKey, KeyInfo::class.java)
        check(keyInfo.isInsideSecureHardware) {
            deleteKey(alias)
            "This tablet does not provide a hardware-backed Android Keystore"
        }

        val securityLevel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            when (keyInfo.securityLevel) {
                KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
                KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
                else -> {
                    deleteKey(alias)
                    error("The kiosk key is not protected by TEE or StrongBox")
                }
            }
        } else {
            "tee"
        }

        val certificateChain = keyStore.getCertificateChain(alias)
            ?.map { Base64.encodeToString(it.encoded, Base64.NO_WRAP) }
            .orEmpty()
        check(certificateChain.isNotEmpty()) {
            deleteKey(alias)
            "Android Keystore did not provide a key-attestation certificate chain"
        }

        identityStore.savePendingAlias(alias)
        return AttestedKey(
            alias = alias,
            publicKeySpki = Base64.encodeToString(
                keyStore.getCertificate(alias).publicKey.encoded,
                Base64.NO_WRAP,
            ),
            certificateChain = certificateChain,
            securityLevel = securityLevel,
        )
    }

    fun signAuthentication(
        challengeId: String,
        challenge: String,
        expiresAt: String,
    ): JSONObject {
        val deviceId = requireNotNull(identityStore.deviceId) {
            "This app has not been paired"
        }
        val alias = requireNotNull(identityStore.activeKeyAlias) {
            "This app has no active kiosk key"
        }
        val canonical = KioskSigningContract.authentication(
            deviceId = deviceId,
            challengeId = challengeId,
            challenge = challenge,
            expiresAt = expiresAt,
        )

        return JSONObject()
            .put("device_id", deviceId)
            .put("signature", sign(alias, canonical))
    }

    fun signRequest(
        method: String,
        path: String,
        bodySha256: String,
    ): JSONObject {
        val deviceId = requireNotNull(identityStore.deviceId) {
            "This app has not been paired"
        }
        val alias = requireNotNull(identityStore.activeKeyAlias) {
            "This app has no active kiosk key"
        }
        val requestId = UUID.randomUUID().toString()
        val issuedAt = System.currentTimeMillis()
        val canonical = KioskSigningContract.request(
            deviceId = deviceId,
            requestId = requestId,
            issuedAt = issuedAt,
            method = method,
            path = path,
            bodySha256 = bodySha256,
        )

        return JSONObject()
            .put("device_id", deviceId)
            .put("request_id", requestId)
            .put("issued_at", issuedAt)
            .put("signature", sign(alias, canonical))
    }

    fun attestedKeyJson(attestedKey: AttestedKey): JSONObject {
        return JSONObject()
            .put("public_key_spki", attestedKey.publicKeySpki)
            .put("certificate_chain", JSONArray(attestedKey.certificateChain))
            .put("security_level", attestedKey.securityLevel)
    }

    private fun generate(alias: String, challenge: ByteArray, strongBox: Boolean) {
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
            .setUserAuthenticationRequired(false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(strongBox)
        }

        KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            ANDROID_KEYSTORE,
        ).apply {
            initialize(builder.build())
            generateKeyPair()
        }
    }

    private fun sign(alias: String, canonical: String): String {
        val privateKey = requireNotNull(keyStore.getKey(alias, null)) {
            "The paired kiosk key is unavailable"
        }
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey as java.security.PrivateKey)
        signature.update(canonical.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(
            signature.sign(),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        )
    }

    private fun deleteKey(alias: String) {
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val CHALLENGE_BYTES = 32
    }
}
