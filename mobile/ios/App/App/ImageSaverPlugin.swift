import UIKit
import Capacitor

@objc(ImageSaverPlugin)
public class ImageSaverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ImageSaverPlugin"
    public let jsName = "ImageSaver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    @objc func save(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), !encoded.isEmpty,
              encoded.utf8.count <= 40 * 1024 * 1024,
              let data = Data(base64Encoded: encoded),
              let name = call.getString("name"),
              name.range(of: "^image-[a-f0-9]{8}\\.(png|jpg|webp)$", options: .regularExpression) != nil,
              let mime = call.getString("mime"),
              ["image/png", "image/jpeg", "image/webp"].contains(mime) else {
            call.reject("图片参数无效")
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            call.reject("保存图片失败：\(error.localizedDescription)")
            return
        }
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController, controller.presentedViewController == nil else {
                try? FileManager.default.removeItem(at: directory)
                call.reject("当前无法打开图片保存窗口，请关闭其它窗口后重试")
                return
            }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            sheet.completionWithItemsHandler = { _, completed, _, error in
                try? FileManager.default.removeItem(at: directory)
                if let error = error { call.reject("保存图片失败：\(error.localizedDescription)") }
                else { call.resolve(["saved": completed, "canceled": !completed]) }
            }
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = controller.view
                popover.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            controller.present(sheet, animated: true)
        }
    }
}

class AppBridgeViewController: CAPBridgeViewController {
    /**
     * 运行时注册「工程内自带的插件」。
     *
     * 这里注册的都是没有单独 npm 包的原生插件（`packageClassList` 里那份清单由
     * CLI 从 node_modules 生成，管不到手写的 Swift 文件）。漏注册的后果是静默的：
     * JS 侧 `Capacitor.isPluginAvailable('X')` 返回 false，代码退到降级路径，
     * 用户只会觉得「功能没了」，日志里什么都没有。
     *
     *   · ImageSaver —— 保存助手生成的图片（Android 上是 SaveFile 之外的独立插件）
     *   · SaveFile   —— 导出账号 / 配置到「文件 → 我的 iPhone → Agent2API → Downloads」
     */
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ImageSaverPlugin())
        bridge?.registerPluginInstance(SaveFilePlugin())
    }
}
