package com.squiresapp.yardkiosk

import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class KioskWebViewClient(
    private val allowedOrigin: Uri,
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        return !isAllowedTopLevelUrl(request.url)
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        if (!isAllowedTopLevelUrl(Uri.parse(url))) {
            view.stopLoading()
            return
        }
        super.onPageStarted(view, url, favicon)
    }

    override fun onPageFinished(view: WebView, url: String) {
        CookieManager.getInstance().flush()
        super.onPageFinished(view, url)
    }

    override fun onReceivedSslError(
        view: WebView,
        handler: SslErrorHandler,
        error: SslError,
    ) {
        handler.cancel()
    }

    private fun isAllowedTopLevelUrl(url: Uri): Boolean {
        return url.scheme == allowedOrigin.scheme
            && url.host == allowedOrigin.host
            && effectivePort(url) == effectivePort(allowedOrigin)
            && (url.path == "/yard-kiosk" || url.path?.startsWith("/yard-kiosk/") == true)
    }

    private fun effectivePort(uri: Uri): Int {
        if (uri.port >= 0) return uri.port
        return if (uri.scheme == "https") 443 else 80
    }
}
