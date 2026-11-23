import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        /*
         * 窗口只建一次，谁先建听谁的。
         *
         * ── 为什么不是无条件 `window = UIWindow(...)` ─────────────────
         * 本工程的 Info.plist 里同时存在三条和初始界面有关的声明：
         *   · UIApplicationSceneManifest → UISceneStoryboardFile = Main
         *   · UIMainStoryboardFile = Main
         *   · 这里的 SceneDelegate
         * Main.storyboard 的初始控制器就是 AppBridgeViewController（带
         * ImageSaverPlugin 注册的那个子类）。当 UISceneStoryboardFile 生效时，
         * UIKit 会先把故事板里的控制器装进一个窗口、赋给 `window`，之后再回调
         * 本方法。此时再 `window = UIWindow(...)` 就会造出**第二个**
         * CAPBridgeViewController —— 两个 WKWebView、两份 Capacitor 实例，
         * 表现为请求翻倍、登录态互相覆盖，很难从现象追回原因。
         *
         * 反过来，如果某天把 UISceneStoryboardFile 去掉（UIKit 不再代建窗口），
         * `window` 就是 nil，这时才需要自己建 —— 否则启动即黑屏，日志里什么
         * 都没有。
         *
         * 所以判据就是 `window == nil`：故事板给了就接管，没给就自己造。
         * 两条路径都只有一个 AppBridgeViewController。
         */
        if window == nil {
            window = UIWindow(windowScene: windowScene)
            window?.rootViewController = AppBridgeViewController()
        }
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}