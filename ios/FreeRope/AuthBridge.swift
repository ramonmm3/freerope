import AuthenticationServices
import UIKit
import WebKit

/// Sign in with Google or Apple for the web app (app/account.js). Google refuses to sign in inside
/// an embedded web view, so the page hands us the Supabase sign-in URL and we show it in Apple's
/// secure browser sheet, then pass back the freerope://auth-callback?code=… it ends on.
final class AuthBridge: NSObject, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
    weak var webView: WKWebView?
    private var session: ASWebAuthenticationSession?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let id = body["id"] as? String,
              let urlString = body["url"] as? String, let url = URL(string: urlString),
              let scheme = body["scheme"] as? String else { return }

        session?.cancel()
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                if let callback {
                    self?.reply(id, ok: true, callback.absoluteString)
                } else {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    self?.reply(id, ok: false, cancelled ? "cancelled" : (error?.localizedDescription ?? "Sign-in failed"))
                }
                self?.session = nil
            }
        }
        session.presentationContextProvider = self
        // Keep the user's Google/Apple sign-in from Safari, so most people just tap Continue.
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { reply(id, ok: false, "Sign-in couldn't start") }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        webView?.window ?? ASPresentationAnchor()
    }

    private func reply(_ id: String, ok: Bool, _ value: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [id, value]),
              let args = String(data: data, encoding: .utf8) else { return }
        // args is ["id","value"]; spread it into __auth.reply(id, ok, value).
        webView?.evaluateJavaScript("(function(a){__auth.reply(a[0], \(ok), a[1])})(\(args))", completionHandler: nil)
    }
}
