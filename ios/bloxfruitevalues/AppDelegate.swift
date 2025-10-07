import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

// 3rd-party SDKs (only if you actually use them)
import FBSDKCoreKit
import GoogleSignIn

@main
class AppDelegate: RCTAppDelegate {

  override init() {
    super.init()
    // If you use TurboModules/Fabric, RCTAppDelegate handles flags internally for RN 0.81.
    // You generally don’t need to set anything else here.
  }

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil
  ) -> Bool {
    // RN 0.81: prepare app early (safe for UIKit setup, appearance, etc.)
    RCTAppSetupPrepareApp(application)

    // React Native module/bootstrap
    self.moduleName = "bloxfruitevalues"
    self.dependencyProvider = RCTAppDependencyProvider()
    self.initialProps = [:]

    // (Optional) Facebook SDK launch hook (only if you use FB login/analytics)
    ApplicationDelegate.shared.application(
      application,
      didFinishLaunchingWithOptions: launchOptions
    )

    // Continue with RN’s own launch pipeline
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // MARK: - JS bundle (Metro in Debug, prebundled in Release)

  override func sourceURL(for bridge: RCTBridge!) -> URL! {
    return self.bundleURL()
  }

  override func bundleURL() -> URL! {
    #if DEBUG
      return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }

  // MARK: - Deep links / URL opens (custom schemes)

  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    // Facebook
    if ApplicationDelegate.shared.application(app, open: url, options: options) {
      return true
    }
    // Google Sign-In
    if GIDSignIn.sharedInstance.handle(url) {
      return true
    }
    // Fall back to RN linking if needed
    return super.application(app, open: url, options: options)
  }

  // MARK: - Universal Links (iOS 13+ Scene-based)
  // If you support associated domains (apple-app-site-association), keep these:

  @available(iOS 13.0, *)
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    // Facebook
    if ApplicationDelegate.shared.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: nil
    ) {
      return
    }
    // Otherwise let RN handle it
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: nil
    )
  }

  // If your project still relies on App-level universal links (older setups):
  override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    // Facebook
    if ApplicationDelegate.shared.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    ) {
      return true
    }
    // React Native
    return RCTLinkingManager.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
  }
}
