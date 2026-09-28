package com.squiresapp.yardkiosk

object KioskSigningContract {
    private const val AUTH_DOMAIN = "AVS-YARD-KIOSK-AUTH-V1"
    private const val REQUEST_DOMAIN = "AVS-YARD-KIOSK-REQUEST-V1"
    private val allowedMethods = setOf("GET", "POST")
    private val pathPattern = Regex("^/[A-Za-z0-9_?&=./%-]{1,500}$")
    private val sha256Pattern = Regex("^[a-f0-9]{64}$")

    fun authentication(
        deviceId: String,
        challengeId: String,
        challenge: String,
        expiresAt: String,
    ): String = listOf(
        AUTH_DOMAIN,
        deviceId,
        challengeId,
        challenge,
        expiresAt,
    ).joinToString("\n")

    fun request(
        deviceId: String,
        requestId: String,
        issuedAt: Long,
        method: String,
        path: String,
        bodySha256: String,
    ): String {
        val normalizedMethod = method.uppercase()
        require(normalizedMethod in allowedMethods) { "Unsupported kiosk request method" }
        require(path.startsWith("/api/inventory/kiosk/")) { "Unsupported kiosk request path" }
        require(pathPattern.matches(path)) { "Invalid kiosk request path" }
        require(sha256Pattern.matches(bodySha256)) { "Invalid request body digest" }
        return listOf(
            REQUEST_DOMAIN,
            deviceId,
            requestId,
            issuedAt.toString(),
            normalizedMethod,
            path,
            bodySha256,
        ).joinToString("\n")
    }
}
