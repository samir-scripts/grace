// Runs the real system WebKit engine without showing a window or changing preferences.
import Cocoa
import WebKit

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

final class GlassProbe: NSObject, WKNavigationDelegate {
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 360, height: 478))

    func start() throws {
        web.navigationDelegate = self
        let css = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        web.loadHTMLString("<html style='--glass-canvas:rgba(24,26,27,0.6)'><head><style>\(css)</style></head><body>Glass probe</body></html>", baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        web.evaluateJavaScript("""
        (() => {
          const root = document.documentElement;
          function paint(style, material) {
            root.dataset.uiStyle = style;
            root.dataset.windowMaterial = material;
            return {
              html: getComputedStyle(root).backgroundColor,
              body: getComputedStyle(document.body).backgroundColor
            };
          }
          return JSON.stringify({
            reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches,
            notReduced: matchMedia('not (prefers-reduced-transparency: reduce)').matches,
            frosted: paint('glass', 'frosted'),
            opaque: paint('glass', 'opaque'),
            otherStyle: paint('pomotroid', 'frosted')
          });
        })()
        """) { result, error in
            if let result = result { print("GLASS_PROBE:\(result)") }
            if let error = error { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
            app.terminate(nil)
        }
    }
}

let probe = GlassProbe()
try probe.start()
DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
    fputs("Native WebKit Glass probe timed out\n", stderr)
    exit(1)
}
app.run()
