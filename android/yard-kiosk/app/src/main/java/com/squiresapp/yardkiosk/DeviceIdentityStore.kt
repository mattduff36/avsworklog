package com.squiresapp.yardkiosk

import android.content.Context

class DeviceIdentityStore(context: Context) {
    private val preferences = context.getSharedPreferences(
        "yard_kiosk_hardware_identity",
        Context.MODE_PRIVATE,
    )

    val deviceId: String?
        get() = preferences.getString(KEY_DEVICE_ID, null)

    val activeKeyAlias: String?
        get() = preferences.getString(KEY_ACTIVE_ALIAS, null)

    val pendingKeyAlias: String?
        get() = preferences.getString(KEY_PENDING_ALIAS, null)

    fun hasActiveIdentity(): Boolean = !deviceId.isNullOrBlank() && !activeKeyAlias.isNullOrBlank()

    fun savePendingAlias(alias: String) {
        check(preferences.edit().putString(KEY_PENDING_ALIAS, alias).commit()) {
            "Unable to persist the pending kiosk key"
        }
    }

    fun commitPendingIdentity(deviceId: String) {
        val pendingAlias = requireNotNull(pendingKeyAlias) {
            "No pending kiosk key is available"
        }
        check(
            preferences.edit()
                .putString(KEY_DEVICE_ID, deviceId)
                .putString(KEY_ACTIVE_ALIAS, pendingAlias)
                .remove(KEY_PENDING_ALIAS)
                .commit(),
        ) {
            "Unable to persist the kiosk identity"
        }
    }

    fun clear() {
        check(preferences.edit().clear().commit()) {
            "Unable to clear the kiosk identity"
        }
    }

    private companion object {
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_ACTIVE_ALIAS = "active_key_alias"
        const val KEY_PENDING_ALIAS = "pending_key_alias"
    }
}
