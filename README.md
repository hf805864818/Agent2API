# Agent2API · iOS 版

把 `Agent2API-3.4.2-安卓版.zip` 里的这套 Capacitor 工程，做成能在 iPhone 上装、并且由
GitHub Actions 自动出 IPA 的仓库。

**状态：已编译通过并出包。** CI 用 Xcode 26.3 / macOS 15 arm64 跑到 `BUILD SUCCEEDED`，
产物经结构校验（arm64、BundleId、版本、ATS、Web 资源、文件共享键全部命中）。

| 直接下载 | 说明 |
|---|---|
| [Releases](https://github.com/hf805864818/Agent2API/releases) | `-unsigned.ipa` 给 TrollStore（巨魔），`-adhoc.ipa` 给爱思 / Sideloadly |
| [Actions](https://github.com/hf805864818/Agent2API/actions) | 每次 push 自动出包，artifact 保留 30 天 |

---

## 一、这套工程是什么

一个 Capacitor 应用，三层：

| 层 | 位置 | 内容 | iOS 复用 |
|---|---|---|---|
| Web 界面 | `mobile/src`（React 19 + Tailwind v4）→ `vite build --mode apk` → `mobile/android-www/` | 单文件 IIFE（`mobile.js` 1.89 MB）+ 5 套词典 + 提供商图标，全部相对路径 | **100%**，原样打进 WKWebView |
| 原生壳 | `mobile/ios/App`（Swift + Capacitor 8.5.3，SPM） | WebView 宿主、`ImageSaverPlugin`、`SaveFilePlugin`、SceneDelegate | 已补齐并编译通过 |
| 原生壳（Android） | `mobile/android`（Gradle + JDK 21） | 保活前台服务、`SaveFile`、`ApkUpdater`、下拉磁贴 | iOS 用不上 |
| 网关 | 你电脑上的 `agent2api.exe`（默认 3065） | 提供 `/api/*` | 不变 |

关键点：**Web 层本来就按 iOS 写过分支**。`lib/servers.ts` 的 `nativePlatform()` 会返回 `'ios'`，
更新面板在 iOS 上只跳 GitHub Release、`assistant-image-save.ts` 走原生 `ImageSaver`、
`capacitor.config.ts` 里连「iOS 为什么不能用 https scheme」都写在注释里。原来的包缺的只是
原生出包链路和 iOS 侧的 `SaveFile`。

## 二、改了什么

原生层四处，Android 侧一行没动（`android2api-release.jks` / `keystore.properties` 没入库）。

| 文件 | 改动 | 为什么 |
|---|---|---|
| `ios/App/App/SceneDelegate.swift` | 无条件建窗口 → `if window == nil` 才建 | `Info.plist` 同时有 `UISceneStoryboardFile = Main`，UIKit 会先装一个 `AppBridgeViewController` 再回调本方法；原写法会造出**两个 WKWebView**——请求翻倍、登录态互相覆盖，且几乎无法从日志定位 |
| `ios/App/App/SaveFilePlugin.swift` | **新增**。写 `Documents/Downloads/<name>`，返回给人看的相对路径，同名文件自动加后缀 | iOS 没有安卓那个 `DIRECTORY_DOWNLOADS`；缺它时「导出账号」只会静默退化成复制到剪贴板 |
| `ios/App/App/ImageSaverPlugin.swift` | 在 `capacitorDidLoad()` 里补注册 `SaveFilePlugin` | 手写插件不在 `packageClassList` 里，不注册就是 `isPluginAvailable` 返回 false，功能静默消失 |
| `ios/App/App/Info.plist` | `armv7` → `arm64`；新增 `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace` | 二进制只产 arm64；后两个键让导出文件出现在「文件 → 我的 iPhone → Agent2API」 |
| `project.pbxproj` | `MARKETING_VERSION 1.0` → `3.4.2`，并把 `SaveFilePlugin.swift` 挂进 Sources | 设置页「关于」读 `__APP_VERSION__`（3.4.2），plist 写 1.0 会让版本检查自己跟自己打架 |

## 三、出包

### GitHub Actions（已配置好，不需要任何 Secret）

- **手动**：Actions → `iOS IPA` → Run workflow。可勾「从源码重建 Web 产物」。
- **自动**：push 到 `main` 且改动涉及 iOS 工程 / 打包脚本时自动跑。
- **发版**：`git tag v3.4.2 && git push origin v3.4.2` → `iOS Release` 工作流出包并把 IPA 挂到 Release。

全程 `CODE_SIGNING_ALLOWED=NO`，不碰证书；runner 是 `macos-15` + `latest-stable` Xcode。

产物三样：

| 文件 | 用途 |
|---|---|
| `Agent2API-<ver>-<n>-unsigned.ipa` | 未签名。TrollStore / 巨魔、AppSync Unified、越狱机 |
| `Agent2API-<ver>-<n>-adhoc.ipa` | ad-hoc 签名。爱思助手、Sideloadly 等会重签的工具 |
| `build-info.json` | 版本、commit、Xcode 版本、两个包的 SHA-256 |

脚本内置 11 项产物自检（可执行文件 / 架构 / Web 资源 / 运行配置 / BundleId / 版本号 /
build 号 / 显示名 / 最低系统 / ATS 例外 / 局域网权限），任一项不过直接失败，不发残包。

### 本地 macOS

```bash
(cd mobile && npm ci)
bash scripts/build-ipa.sh        # 脚本自己会 cd，仓库根目录执行即可
```

要求 Xcode 16+（Capacitor 8 的 SPM 包要求）。产物在 `build/out/`。
Windows 上只能跑到 `cap copy ios`（已验证），`xcodebuild` 只有 macOS 有。

## 四、装到 iPhone 14 Pro 上

你的机器是 Relaxin 越狱 + 有巨魔，走 **TrollStore**：

1. 手机上打开 https://github.com/hf805864818/Agent2API/releases/latest 下载 `-unsigned.ipa`。
2. 分享 → 用 TrollStore 打开（或 TrollStore 里「+」选文件）。
3. Install。永久有效，不会 7 天掉签。

其他两条路：越狱 + AppSync Unified 直接装 `unsigned.ipa`；Sideloadly / 爱思装 `adhoc.ipa`。

### 首次打开必须做的一步

会弹「**Agent2API 想要查找并连接本地网络上的设备**」——**必须允许**。拒绝后连不上局域网网关，
而且不报错、只是一直 fetch 失败。补救：设置 → 隐私与安全性 → 本地网络 → 打开 Agent2API。

然后填网关：主机 = 电脑局域网 IP，端口 `3065`（有常用端口快捷按钮），保存前会先探活。

网关要监听 `0.0.0.0`（桌面端：设置 → 局域网访问；headless：`AGENT2API_HOST=0.0.0.0`），
Windows 防火墙放行 TCP 3065。

## 五、iOS 与 Android 的差异

| 能力 | Android | iOS | 说明 |
|---|---|---|---|
| 界面 / 全部管理功能 | ✅ | ✅ | 同一份 Web 产物 |
| 连局域网 http 网关 | ✅ | ✅ | ATS 三个例外键；CORS 实测放行 `capacitor://localhost` |
| 导出账号文件 | ✅ `SaveFile` | ✅ `SaveFilePlugin` | 落到「文件 → 我的 iPhone → Agent2API → Downloads」，同名自动加 `-1` |
| 保存助手生成的图片 | ✅ | ✅ `ImageSaverPlugin` | `UIActivityViewController` 分享面板 |
| 应用内更新（下载安装包） | ✅ `ApkUpdater` | ❌ 只跳 GitHub Release | 苹果不允许 App 自装可执行代码 |
| 连接保活 / 常驻通知 / 磁贴 / 开机自连 | ✅ | ❌ | Android 前台服务专属 |
| 人机验证的 SHA-256 | `crypto.subtle` | 纯 JS 兜底（慢一点，结果一致） | iOS 页面 origin 是 `capacitor://localhost`，不算安全上下文 |

## 六、验证状态

| 项 | 状态 | 依据 |
|---|---|---|
| 源码结构 / 依赖链完整 | **Observed** | 逐文件核对：4 个 Swift 源文件、storyboard、Assets、SPM 依赖、scheme ↔ target ID |
| `cap copy ios` 产出 | **Observed** | 本机与 CI 各跑一次：`public/` 7.4 MB、`capacitor.config.json`、`config.xml` |
| 网关对 iOS origin 的 CORS | **Observed** | 实测 `OPTIONS /api/panel/status` + `Origin: capacitor://localhost` → 204 + `access-control-allow-origin: *` |
| Capacitor 8.5.3 API 对齐 | **Observed** | 对照上游源码：`capacitorDidLoad()`、`CAPBridgedPlugin` 均在 |
| `xcodebuild` 编译 | **Observed** | CI run #2：`BUILD SUCCEEDED`，Xcode 26.3 / SDK 26.2 / arm64 |
| IPA 结构 | **Observed** | 解包核对：arm64 Mach-O、`public/mobile.js` 1,891,382 字节与源一致、ATS/文件共享键齐全、ad-hoc 版比 unsigned 大 21 KB（签名生效） |
| 首次 CI 失败并修复 | **Observed** | run #1：`SaveFilePlugin.swift:134 unterminated comment`（Swift 块注释可嵌套，注释里写 `ui/i18n/*` 等于又开一层）→ 修掉 → run #2 绿 |
| 真机安装 / 启动 / 连网关 / 导出落盘 | **NOT RUN** | 需要你在设备上试；这三项本机无从验证 |

## 七、目录

```
.
├─ .github/workflows/
│  ├─ ios-ipa.yml          # 手动 / push 出包 + artifact
│  └─ ios-release.yml      # tag 出包 + GitHub Release
├─ scripts/build-ipa.sh    # 唯一构建入口（本地与 CI 共用）
├─ mobile/                 # Capacitor 工程
│  ├─ ios/App/             # iOS 原生工程（含 SaveFilePlugin）
│  └─ android-www/         # web 产物（cap copy 的输入，与 APK 同源）
├─ ui-kit/ ui-shared/      # web 源码引用的共享库
├─ ui/ ui-islands/         # 桌面端前端（仅 rebuild_web 时用到）
└─ docs/iOS-移植分析.md     # 详细技术分析
```

## 八、下一步（可选）

1. **真机验证**：装上后把启动、连网关、导出账号三件事过一遍，有问题贴日志。
2. **iOS 侧「应用内更新」**：现在只跳 Release。越狱机上理论上可以接 `installipa`，
   但会偏离侧载分发的通用路径，没做。
3. **启动图适配**：`Splash.imageset` 用 2732×2732 通用图，14 Pro 的比例下会被裁。
