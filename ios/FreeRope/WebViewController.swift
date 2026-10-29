import UIKit
import WebKit

/// Hosts the bundled web app (../app) and gives it Bluetooth through BluetoothBridge.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let scheme = "freerope"
    private let bridge = BluetoothBridge()
    private let auth = AuthBridge()
    private var webView: WKWebView!

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: Self.scheme)
        config.websiteDataStore = .default() // keeps workouts in localStorage across launches
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let controller = config.userContentController
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
           let source = try? String(contentsOf: url) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        controller.add(bridge, name: "ble")
        controller.add(auth, name: "auth")
        #if DEBUG
        // App Store screenshots (.github/workflows/ios.yml): FREEROPE_SHOT=<name> loads sample
        // workouts and opens that screen. Debug builds only; never in the App Store app.
        if let shot = ProcessInfo.processInfo.environment["FREEROPE_SHOT"],
           let url = Bundle.main.url(forResource: "screenshots", withExtension: "js"),
           let source = try? String(contentsOf: url) {
            controller.addUserScript(WKUserScript(source: "window.FREEROPE_SHOT = \"\(shot)\";\n" + source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never // the page handles safe areas
        webView.scrollView.bounces = false
        webView.allowsLinkPreview = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        bridge.webView = webView
        bridge.presenter = self
        auth.webView = webView
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: URL(string: "\(Self.scheme)://app/index.html")!))
    }

    // Links that leave the app (target=_blank, mailto:, https:) open in Safari or their own app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, url.scheme != Self.scheme, url.scheme != "about" else {
            return decisionHandler(.allow)
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // Native alert/confirm for the page's window.alert and window.confirm.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    // If iOS kills the web content process in the background, reload instead of showing a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

/// Serves freerope://app/<path> from the app bundle's "app" folder, so ES modules and
/// localStorage behave like they do on the website.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("app", isDirectory: true)

    private static let types: [String: String] = [
        "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
        "json": "application/json", "webmanifest": "application/manifest+json", "svg": "image/svg+xml",
        "png": "image/png", "jpg": "image/jpeg", "mp3": "audio/mpeg", "wav": "audio/wav",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
