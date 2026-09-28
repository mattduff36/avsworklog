# Yard Inventory Android kiosk

This is the signed Android launcher for the wall-mounted Yard Inventory tablet.
It hosts the existing web UI in a restricted WebView and keeps the tablet
identity in Android Keystore. The APK is sideloaded; Google Play is not
required.

## Trust and persistence

- Package id: `com.squiresapp.yardkiosk`
- Allowed origin: `https://www.squiresapp.com`
- The ECDSA P-256 private key is non-exportable and must be TEE- or
  StrongBox-backed.
- The key and private app preferences survive process termination, power loss,
  reboot, and an APK update signed with the same release key.
- Uninstall, clear-data, factory reset/reimage, storage or hardware failure,
  application-id change, or tablet replacement requires manager pairing again.
- Android backup and device-to-device transfer are disabled.

## Release signing

Create one release keystore outside this repository and retain it in the
company password/secret manager. Every update installed over the existing app
must use the same application id and signing key.

Provide these Gradle properties through the developer machine or CI secret
store, never in a tracked file:

```properties
AVS_KIOSK_KEYSTORE_PATH=C:/secure/location/avs-yard-kiosk.jks
AVS_KIOSK_KEYSTORE_PASSWORD=...
AVS_KIOSK_KEY_ALIAS=yard-kiosk
AVS_KIOSK_KEY_PASSWORD=...
```

The SHA-256 digest of the release signing certificate must also be configured
on the web application as `YARD_KIOSK_ANDROID_SIGNING_CERT_SHA256`. Configure
the approved Android key-attestation root certificate digest(s) in
`YARD_KIOSK_ANDROID_ATTESTATION_ROOT_SHA256`. Values are comma-separated,
colon-free SHA-256 hex digests. Do not commit their associated private keys.

## Build and installation

Open this directory in Android Studio and install the requested SDK. The pinned
Gradle wrapper is committed with the project. A release build requires the four
signing properties above. Repository policy requires explicit test-build
authorization before running an APK build.

Install the resulting release APK by USB/ADB or Android's package installer.
Future updates are installed over the existing package; do not uninstall the
app because uninstalling intentionally deletes the hardware identity.

## Acceptance

On the physical tablet:

1. Install and pair once through Inventory Settings.
2. Verify stock and a controlled test transfer.
3. Hard-refresh, force-stop, reopen, and power-cycle repeatedly.
4. Install a newer APK over the existing app and verify silent authentication.
5. Copy the WebView cookies to another client and verify kiosk APIs reject it.
6. Revoke the device in Inventory Settings and verify both the current session
   and subsequent signed authentication fail.
