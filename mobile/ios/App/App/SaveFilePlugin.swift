import Foundation
import Capacitor

/**
 * 把文本写成文件，落到「文件」App 里能找到的位置。
 *
 * ── 为什么 iOS 需要单独一个插件 ────────────────────────────────
 * 安卓侧的 `SaveFilePlugin.java` 写的是 `Environment.DIRECTORY_DOWNLOADS`，
 * 那个路径在 iOS 上不存在。Web 层 `lib/save-file.ts` 的探测逻辑是「有
 * `Capacitor.Plugins.SaveFile` 就落盘，没有就退剪贴板」，所以 iOS 缺这个插件
 * 时导出账号只会静默变成「复制到剪贴板」——功能能用，但用户拿不到文件。
 *
 * ── 为什么落在 Documents/Downloads，而不是临时目录 ────────────
 * 临时目录（`NSTemporaryDirectory()`）的文件系统随时可能回收，用户去「文件」
 * App 里翻不到；Documents 是应用自己的持久目录，配合 Info.plist 的
 * `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`，会直接出现在
 * 「文件 → 我的 iPhone → Agent2API」下，可以 AirDrop / 微信 / 邮件发出去。
 *
 * 目录名用 `Downloads`（不是中文）：安卓那句提示是「保存到「下载」目录」，
 * 在 iOS 上落到一个真叫 Downloads 的文件夹，文案与事实一致，不用改词表
 * （`ui/i18n` 下的词典是 `i18n-src` 里 JSON 的构建产物，包里没有源头，不能手改）。
 *
 * ── 返回值 ────────────────────────────────────────────────────
 * `{ ok, filename, bytes, path }`，其中 `path` 是**给人看的相对路径**
 * （`Agent2API/Downloads/xxx.json`），界面直接把它拼进「已保存到 {path}」。
 * 不要在这里返回沙盒绝对路径：那串 `/var/mobile/Containers/Data/...` 对用户
 * 毫无意义，而且是每次安装都会变的 UUID。
 */
@objc(SaveFilePlugin)
public class SaveFilePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SaveFilePlugin"
    public let jsName = "SaveFile"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    /// 导出目录名。改这里要同步改 README 与文档里的截图说明。
    private static let folderName = "Downloads"
    /// 单文件上限。账号导出实测几百 KB，32 MB 足够，也挡住误传大文件撑爆沙盒。
    private static let maxBytes = 32 * 1024 * 1024

    @objc func save(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"), !filename.isEmpty else {
            call.reject("缺少文件名")
            return
        }
        guard let content = call.getString("content") else {
            call.reject("缺少文件内容")
            return
        }
        // 先按字符数粗筛，避免为一个超大字符串做一次完整 UTF-8 编码
        guard content.utf8.count <= Self.maxBytes else {
            call.reject("内容超过 32 MB，无法写入")
            return
        }
        guard let safeName = Self.sanitize(filename) else {
            call.reject("文件名不合法：\(filename)")
            return
        }

        let data = Data(content.utf8)
        // 写盘放到后台队列：账号导出可能是几十万行 JSON，同步写会卡住 bridge
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let directory = try Self.downloadsDirectory()
                let target = Self.uniqueURL(in: directory, name: safeName)
                try data.write(to: target, options: .atomic)
                call.resolve([
                    "ok": true,
                    "filename": target.lastPathComponent,
                    "bytes": data.count,
                    "path": "\(Self.appName())/\(Self.folderName)/\(target.lastPathComponent)"
                ])
            } catch {
                call.reject("保存失败：\(error.localizedDescription)")
            }
        }
    }

    // MARK: - 路径

    private static func downloadsDirectory() throws -> URL {
        let documents = try FileManager.default.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = documents.appendingPathComponent(folderName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// 同名文件不覆盖：加 `-1`、`-2` 后缀。返回的 `filename` 是最终落盘的那个名字，
    /// 界面提示才不会说错。
    private static func uniqueURL(in directory: URL, name: String) -> URL {
        let candidate = directory.appendingPathComponent(name, isDirectory: false)
        guard FileManager.default.fileExists(atPath: candidate.path) else { return candidate }

        let ext = (name as NSString).pathExtension
        let stem = (name as NSString).deletingPathExtension
        for index in 1...999 {
            let next = ext.isEmpty ? "\(stem)-\(index)" : "\(stem)-\(index).\(ext)"
            let url = directory.appendingPathComponent(next, isDirectory: false)
            if !FileManager.default.fileExists(atPath: url.path) { return url }
        }
        // 极端情况：同名文件多到 999 个，退回带 UUID 的名字，宁可难认也不能失败
        return directory.appendingPathComponent("\(stem)-\(UUID().uuidString).\(ext.isEmpty ? "txt" : ext)", isDirectory: false)
    }

    // MARK: - 校验

    /// 只留最后一段、去掉路径分隔符与控制字符，并把隐藏文件改成可见名字。
    /// 接受中文（账号名进文件名是正常需求），但不接受任何能跳出目标目录的形态。
    private static func sanitize(_ raw: String) -> String? {
        var name = (raw as NSString).lastPathComponent
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        name = name.replacingOccurrences(of: "\0", with: "")

        let banned = CharacterSet(charactersIn: "/\\:*?\"<>|")
        name = name.components(separatedBy: banned).joined(separator: "_")

        if name.isEmpty || name == "." || name == ".." { return nil }
        if name.hasPrefix(".") { name = "_" + String(name.dropFirst()) }
        if name.count > 128 { name = String(name.prefix(128)) }
        return name
    }

    private static func appName() -> String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? "Agent2API"
    }
}
