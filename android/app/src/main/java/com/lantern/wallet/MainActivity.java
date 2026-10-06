package com.lantern.wallet;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Directory dApps marked `session` run at their real origin inside an
        // Apps-tab iframe (#260), and keep their login in a cross-site
        // (third-party, partitioned) cookie. Android WebView blocks those by
        // default. This allows third-party cookies for EVERY frame in Lantern's
        // WebView, URL-bar pages included: an opaque sandbox only takes away
        // document.cookie and storage, not cookies set or sent over HTTP.
        // super.onCreate builds the bridge (load()); it's null only when the
        // WebView failed to inflate.
        if (bridge != null) {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            }
        }
    }
}
