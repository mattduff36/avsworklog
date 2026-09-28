package com.squiresapp.yardkiosk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class KioskSigningContractTest {
    @Test
    fun authenticationContractMatchesServerLineOrder() {
        val canonical = KioskSigningContract.authentication(
            deviceId = "11111111-1111-4111-8111-111111111111",
            challengeId = "22222222-2222-4222-8222-222222222222",
            challenge = "x".repeat(43),
            expiresAt = "2026-09-28T20:00:00.000Z",
        )

        assertEquals(
            """
            AVS-YARD-KIOSK-AUTH-V1
            11111111-1111-4111-8111-111111111111
            22222222-2222-4222-8222-222222222222
            xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
            2026-09-28T20:00:00.000Z
            """.trimIndent(),
            canonical,
        )
    }

    @Test
    fun requestContractRejectsNonKioskPaths() {
        assertThrows(IllegalArgumentException::class.java) {
            KioskSigningContract.request(
                deviceId = "11111111-1111-4111-8111-111111111111",
                requestId = "33333333-3333-4333-8333-333333333333",
                issuedAt = 1_790_619_000_000,
                method = "POST",
                path = "/api/admin/users",
                bodySha256 = "0".repeat(64),
            )
        }
    }
}
