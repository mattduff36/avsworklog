package com.squiresapp.yardkiosk

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class HardwareIdentityInstrumentedTest {
    @Test
    fun keyIsNonExportableAndIdentitySurvivesStoreRecreation() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val firstStore = DeviceIdentityStore(context)
        firstStore.clear()
        val keyStore = DeviceKeyStore(firstStore)

        val attested = keyStore.createAttestedKey(ByteArray(32) { it.toByte() })
        val androidKeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val privateKey = androidKeyStore.getKey(attested.alias, null)

        assertNull(privateKey.encoded)
        assertFalse(firstStore.hasActiveIdentity())
        firstStore.commitPendingIdentity("11111111-1111-4111-8111-111111111111")

        val recreatedStore = DeviceIdentityStore(context)
        assertTrue(recreatedStore.hasActiveIdentity())
        assertEquals(
            "11111111-1111-4111-8111-111111111111",
            recreatedStore.deviceId,
        )
        assertEquals(attested.alias, recreatedStore.activeKeyAlias)
    }
}
