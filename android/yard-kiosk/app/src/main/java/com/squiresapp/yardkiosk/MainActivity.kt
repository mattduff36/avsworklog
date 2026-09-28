package com.squiresapp.yardkiosk

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.squiresapp.yardkiosk.databinding.ActivityMainBinding
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var identityStore: DeviceIdentityStore

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        enterImmersiveMode()

        identityStore = DeviceIdentityStore(applicationContext)
        val deviceKeyStore = DeviceKeyStore(identityStore)
        val nativeBridge = NativeKioskBridge(identityStore, deviceKeyStore)
        val kioskOrigin = Uri.parse(BuildConfig.KIOSK_ORIGIN)

        require(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            "The installed Android System WebView is too old for secure kiosk identity"
        }

        configureWebView(binding.kioskWebView, kioskOrigin)
        WebViewCompat.addWebMessageListener(
            binding.kioskWebView,
            NATIVE_BRIDGE_NAME,
            setOf(BuildConfig.KIOSK_ORIGIN),
        ) { _, message, sourceOrigin, isMainFrame, replyProxy ->
            val allowed = isMainFrame
                && sourceOrigin.scheme == kioskOrigin.scheme
                && sourceOrigin.host == kioskOrigin.host
                && sourceOrigin.port == kioskOrigin.port
            val response = if (allowed) {
                nativeBridge.handle(message.data ?: "")
            } else {
                JSONObject()
                    .put("ok", false)
                    .put(
                        "error",
                        JSONObject()
                            .put("code", "NATIVE_ORIGIN_REJECTED")
                            .put("message", "Native kiosk identity is unavailable on this page"),
                    )
                    .toString()
            }
            replyProxy.postMessage(response)
        }

        val startPath = if (identityStore.hasActiveIdentity()) {
            "/yard-kiosk/native"
        } else {
            "/yard-kiosk/pair"
        }
        binding.kioskWebView.loadUrl("${BuildConfig.KIOSK_ORIGIN}$startPath")

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    // The wall kiosk has no route back into Android or the main Squires app.
                }
            },
        )
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveMode()
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        binding.kioskWebView.apply {
            stopLoading()
            loadUrl("about:blank")
            removeAllViews()
            destroy()
        }
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(webView: WebView, kioskOrigin: Uri) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString AVSYardKiosk/1"
        }
        webView.webViewClient = KioskWebViewClient(kioskOrigin)
        webView.setBackgroundColor(0xFF020617.toInt())
    }

    @Suppress("DEPRECATION")
    private fun enterImmersiveMode() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    private companion object {
        const val NATIVE_BRIDGE_NAME = "yardKioskNative"
    }
}
