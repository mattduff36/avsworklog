package com.squiresapp.yardkiosk

import android.util.Base64
import org.json.JSONObject
import java.util.UUID

class NativeKioskBridge(
    private val identityStore: DeviceIdentityStore,
    private val deviceKeyStore: DeviceKeyStore,
) {
    fun handle(rawMessage: String): String {
        if (rawMessage.toByteArray(Charsets.UTF_8).size > MAX_MESSAGE_BYTES) {
            return failure(null, "BRIDGE_MESSAGE_TOO_LARGE", "The native request is too large")
        }

        var requestId: String? = null
        return try {
            val request = JSONObject(rawMessage)
            requestId = request.optString("id").takeIf { it.isNotBlank() }
            val action = request.getString("action")
            val payload = request.optJSONObject("payload") ?: JSONObject()
            val result = when (action) {
                "identity.status" -> identityStatus()
                "enroll.attest" -> enrollAttest(payload)
                "enroll.commit" -> enrollCommit(payload)
                "auth.sign" -> authSign(payload)
                "request.sign" -> requestSign(payload)
                "identity.clear" -> clearIdentity()
                else -> error("Unsupported native kiosk action")
            }

            JSONObject()
                .put("id", requestId)
                .put("ok", true)
                .put("result", result)
                .toString()
        } catch (error: Exception) {
            failure(
                requestId,
                "NATIVE_IDENTITY_ERROR",
                error.message ?: "Native kiosk identity failed",
            )
        }
    }

    private fun identityStatus(): JSONObject {
        return JSONObject()
            .put(
                "paired",
                identityStore.hasActiveIdentity()
                    && deviceKeyStore.hasKey(identityStore.activeKeyAlias),
            )
            .put("device_id", identityStore.deviceId)
            .put("pending", deviceKeyStore.hasKey(identityStore.pendingKeyAlias))
    }

    private fun enrollAttest(payload: JSONObject): JSONObject {
        val challenge = decodeChallenge(payload.getString("challenge"))
        val attestedKey = deviceKeyStore.createAttestedKey(challenge)
        return deviceKeyStore.attestedKeyJson(attestedKey)
    }

    private fun enrollCommit(payload: JSONObject): JSONObject {
        val deviceId = requireUuid(payload.getString("device_id"), "device_id")
        identityStore.commitPendingIdentity(deviceId)
        return identityStatus()
    }

    private fun authSign(payload: JSONObject): JSONObject {
        val challengeId = requireUuid(payload.getString("challenge_id"), "challenge_id")
        val challenge = payload.getString("challenge")
        decodeChallenge(challenge)
        val expiresAt = payload.getString("expires_at")
        require(expiresAt.length in 20..40) { "Invalid challenge expiry" }
        return deviceKeyStore.signAuthentication(challengeId, challenge, expiresAt)
    }

    private fun requestSign(payload: JSONObject): JSONObject {
        return deviceKeyStore.signRequest(
            method = payload.getString("method"),
            path = payload.getString("path"),
            bodySha256 = payload.getString("body_sha256"),
        )
    }

    private fun clearIdentity(): JSONObject {
        deviceKeyStore.clearIdentity()
        return identityStatus()
    }

    private fun decodeChallenge(value: String): ByteArray {
        require(value.length in 40..48) { "Invalid kiosk challenge" }
        val bytes = Base64.decode(
            value,
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        )
        require(bytes.size == CHALLENGE_BYTES) { "Invalid kiosk challenge" }
        return bytes
    }

    private fun requireUuid(value: String, field: String): String {
        return try {
            UUID.fromString(value).toString()
        } catch (_: IllegalArgumentException) {
            error("Invalid $field")
        }
    }

    private fun failure(id: String?, code: String, message: String): String {
        return JSONObject()
            .put("id", id)
            .put("ok", false)
            .put(
                "error",
                JSONObject()
                    .put("code", code)
                    .put("message", message.take(MAX_ERROR_LENGTH)),
            )
            .toString()
    }

    private companion object {
        const val MAX_MESSAGE_BYTES = 32 * 1024
        const val MAX_ERROR_LENGTH = 240
        const val CHALLENGE_BYTES = 32
    }
}
