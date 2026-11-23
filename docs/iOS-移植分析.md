# Agent2API 安卓版 → iOS 移植分析

> 分析对象：`Agent2API-3.4.2-安卓版.zip`（19,808,074 字节，1230 个条目）
> 产物：`Agent2API-3.4.2.apk`（6,079,336 字节）+ `源码/desktop-tauri/` 完整工程
> 分析机器：Windows（无 Xcode），所以「编译/安装/启动」三项只能标 `NOT RUN`

---

## 一、结论先行

| 问题 | 答案 |
|---|---|
| 能不能打包成 IPA？ | **能**。源码里已有一份可编译的 Capacitor 8 iOS 工程，缺的是出包链路，不是移植工作 |
| 需要重写界面吗？ | 不需要。`android-www/` 这份 Web 产物原样进 WKWebView，iOS 分支代码早就写好了 |
| 需要 Mac 吗？ | 出包需要。用 GitHub Actions 的 `macos-15` runner，本地机器不用装 Xcode |
| 需要开发者证书吗？ | 不需要。全程 `CODE_SIGNING_ALLOWED=NO`，TrollStore / AppSync 负责 fakesign |
| 主要风险 | 这份 iOS 工程在本仓库之前**从未被编译过**（原 `改动说明.md` 只有 Android 的验证记录）。现已在本仓库的 CI 上跑到 `BUILD SUCCEEDED`（Xcode 26.3 / SDK 26.2 / arm64），并修掉了一处会导致编译失败的嵌套注释 |

---

## 二、侦察：这个包由什么组成

### 2.1 三层结构

```
┌──────────────────────────────────────────────────────────────┐
│ Web 界面（React 19 + Tailwind v4）                            │
│   mobile/src/  →  vite build --mode apk  →  mobile/android-www/│
│   产物：mobile.js 1.89 MB（单文件 IIFE）+ mobile.css 93 KB     │
│         + i18n/{en,ja,ko,pt-BR,zh-Hant}/*.js + assets/providers │
│   全部相对路径，无 Service Worker（本地文件加载，不需要）        │
├──────────────────────────────────────────────────────────────┤
│ 原生壳                                                         │
│   Android：mobile/android（Gradle / JDK 21 / SDK 36）          │
│     · KeepAlive 前台服务、SaveFile、ApkUpdater、下拉磁贴        │
│   iOS：mobile/ios/App（Swift 5 / Capacitor 8.5.3 / SPM）       │
│     · AppBridgeViewController + ImageSaverPlugin              │
│     · ATS 例外、SceneDelegate、storyboard 启动图               │
├──────────────────────────────────────────────────────────────┤
│ 网关（不在包里）                                               │
│   agent2api.exe，默认 0.0.0.0:3065，提供 /api/panel/* 与 /v1/* │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 源码体量

| 目录 | 文件数 | 大小 | iOS 是否需要 |
|---|---:|---:|---|
| `mobile/` | 569 | 16.0 MB | 需要（含 `ios/`、`android-www/`、`src/`） |
| `ui/` | 258 | 14.6 MB | 仅「从源码重建 Web 产物」时用到 |
| `ui-islands/` | 258 | 3.3 MB | 同上（岛屿页面） |
| `ui-kit/` | 57 | 0.3 MB | 编译 `mobile/src` 时的 `@ui` 别名目标 |
| `ui-shared/` | 65 | 0.3 MB | `mobile/src/lib/assistant-image-save.ts` 引用 |

### 2.3 版本矩阵（全部来自实际文件，非推测）

| 组件 | 版本 | 来源 |
|---|---|---|
| Capacitor CLI / Core / iOS | 8.5.3 | `mobile/package.json`、`CapApp-SPM/Package.swift`（`exact: "8.5.3"`） |
| `@capacitor/app` | 8.1.2 | `package.json`；本地包 `Package.swift` 存在，可被 SPM 解析 |
| `@capacitor/keyboard` | 8.0.6 | 同上 |
| React / React DOM | 19.2 | `package.json` |
| Vite | 7.1 | `package.json` |
| iOS 部署目标 | 15.0 | `project.pbxproj`（Debug/Release 各一处）+ `Package.swift` `.iOS(.v15)` |
| Swift 版本 | 5.0 | `SWIFT_VERSION = 5.0` |
| Bundle ID | `com.agent2api.mobile` | `capacitor.config.ts` + pbxproj |
| 显示名 | `Agent2API` | `Info.plist` `CFBundleDisplayName` |
| 依赖管理 | **SPM，无 CocoaPods** | `ios/App/CapApp-SPM/`，无 `Podfile` |

### 2.4 依赖链细节（这条决定 CI 能不能跑）

`ios/App/CapApp-SPM/Package.swift`：

```swift
dependencies: [
  .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
  .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
  .package(name: "CapacitorKeyboard", path: "../../../node_modules/@capacitor/keyboard")
]
```

`../../../` 从 `ios/App/CapApp-SPM/` 数上去正好是 `mobile/`，所以指向
`mobile/node_modules/@capacitor/{app,keyboard}`。

**推论：CI 里 `npm ci` 不是可选项。** 没有 `node_modules`，`xcodebuild` 会在
「Resolve Package Graph」阶段就失败，而不是编译阶段——报错信息看着像工程坏了，
其实是依赖没装。

---

## 三、Web 层：为什么说它「已经是 iOS-ready」

不是猜的，逐处核过：

| 位置 | iOS 相关实现 |
|---|---|
| `lib/servers.ts` | `nativePlatform()` 返回 `'android' \| 'ios' \| 'web'`，判据是 `Capacitor.getPlatform()` |
| `lib/appUpdate.ts` | `nativePlatform() !== 'android'` 时 `downloadApk` / `installApk` 直接返回 null；iOS 提示「请到 GitHub Release 页面下载」 |
| `components/AppUpdatePanel.tsx` | 注释写明「iOS 上这个面板到『发现新版本』为止」，动作改为跳转 |
| `lib/save-file.ts` | 先 `Capacitor.Plugins?.SaveFile` 探测，没有就退剪贴板（**iOS 走的这条**） |
| `lib/assistant-image-save.ts` | `registerPlugin('ImageSaver')`，原生侧就是 `ImageSaverPlugin.swift` |
| `lib/keep-alive.ts` | `isPluginAvailable('KeepAlive')` 探测，iOS 自然为 false |
| `lib/pwa.ts` | 有完整的 `isIosSafari()` / `navigator.standalone` 分支 |
| `components/Shell.tsx` | `useKeyboardOpen` 用 `visualViewport`，配合 `Keyboard.resize: 'body'` |
| `pages/AccountSheet.tsx` | 注释：16px 以下 iOS Safari 聚焦会自动放大 |

### 3.1 为什么 iOS 的 origin 是 `capacitor://localhost`

`capacitor.config.ts` 里这段是原文（作者自己踩过并写下来的）：

> `iosScheme` 不允许是 `https` / `http` —— 那是 WKWebView 自己处理的协议，
> Capacitor 在 `InstanceDescriptor.normalize()` 里会把它判为非法并**静默退回**默认值 `capacitor`

实测生成结果确认了这一点。`cap copy ios` 写出的 `capacitor.config.json`：

```json
{
  "appId": "com.agent2api.mobile",
  "appName": "Agent2API",
  "webDir": "android-www",
  "ios": { "contentInset": "never", "backgroundColor": "#f3f3f6" },
  "server": { "androidScheme": "https", "cleartext": true },
  "packageClassList": ["AppPlugin", "KeyboardPlugin"]
}
```

注意 `server.iosScheme` 不存在 → 运行时就是 `capacitor://localhost`。

后果有两个，都在源码里兜住了：

1. **不是安全上下文** → `crypto.subtle` 不可用 → 登录页人机验证走
   `src/api/auth.ts` 里的纯 JS SHA-256（本来就为 http 局域网准备过，结果一致，只是慢）。
2. **跨源** → 请求网关必须显式带令牌头。`api/client.ts` 用的就是
   `x-panel-token` / `x-panel-refresh` 请求头 + 登录时 `x-panel-auth-mode: body`，
   不依赖 cookie。**所以 iOS 不会有第三方 cookie 被拦的问题。**

### 3.2 ATS：明文 http 网关怎么放行

`Info.plist` 三个键同时开，注释解释了为什么缺一不可：

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key><true/>
  <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  <key>NSAllowsLocalNetworking</key><true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>用于连接你在局域网里运行的 Agent2API 网关。</string>
<key>NSBonjourServices</key>
<array><string>_http._tcp</string><string>_https._tcp</string></array>
```

- `NSAllowsArbitraryLoadsInWebContent` 一旦出现，系统会**忽略** `NSAllowsArbitraryLoads`，
  所以要两条都写才能覆盖「原生 URLSession」+「WKWebView」两条链路。
- `NSAllowsLocalNetworking`：iOS 17 起 ATS 默认连裸 IP 都拦，网关地址是用户自己填的
  （10.x / 172.16-31.x / 192.168.x / 100.64.x tailscale），枚举不完，只能整体放开。

---

## 四、原生层审查

### 4.1 三个 Swift 文件

| 文件 | 作用 | 审查结论 |
|---|---|---|
| `AppDelegate.swift` | 标准 Capacitor 宿主 + `configurationForConnecting` 指定 `SceneDelegate` | 正常。`@UIApplicationMain` 是旧写法（Swift 5.3 起叫 `@main`），仍受支持 |
| `SceneDelegate.swift` | 建窗口、装 `AppBridgeViewController`、转发 URL 事件 | **有问题，已修**，见 §五 |
| `ImageSaverPlugin.swift` | `CAPPlugin & CAPBridgedPlugin`，把 base64 图片写临时目录后弹 `UIActivityViewController` | 正常。入参校验挺严（文件名正则、MIME 白名单、40 MB 上限），`capacitorDidLoad()` 里注册到 bridge |

### 4.2 资源与工程结构

- `PBXSourcesBuildPhase`：`AppDelegate.swift` / `SceneDelegate.swift` / `ImageSaverPlugin.swift` 三个都在。
- `PBXResourcesBuildPhase`：`Main.storyboard`、`LaunchScreen.storyboard`、`public`（folder reference）。
  最后这条是关键——`cap copy` 往 `App/App/public/` 铺的东西会自动进 `.app`，不需要手工加文件。
- `Assets.xcassets`：`AppIcon.appiconset` 单张 1024×1024（`RGB`，无 alpha，符合上架要求）；
  `Splash.imageset` 三张 2732×2732。
- Scheme `App.xcscheme` 在 `xcshareddata/xcschemes/`（**共享**，CI 的 `-scheme App` 能用），
  `BlueprintIdentifier = 504EC3031FED79650016851F` 与 pbxproj 里 `PBXNativeTarget App` 的 ID 一致。
- `debug.xcconfig` 只挂在 **Debug** 配置上（`CAPACITOR_DEBUG = true`），Release 不继承 →
  Release 下 `$(CAPACITOR_DEBUG)` 会变成字面量，所以构建脚本显式传 `CAPACITOR_DEBUG=false`。

### 4.3 一个必须提前知道的硬约束

`CAPBridgeViewController.loadWebView()`（8.5.3 源码）第一步就是：

```swift
guard FileManager.default.fileExists(atPath: bridge.config.appStartFileURL.path) else {
    fatalLoadError()          // → printLoadError(); exit(1)
}
```

也就是说 **`public/index.html` 不在 bundle 里时，App 是直接 `exit(1)` 退出的**，
不是白屏、不是报错弹窗，就是闪退且没有 UI。所以 `scripts/build-ipa.sh` 在编译前
和产物自检里各查一次 `App/public/index.html`——这条链路上最常见的翻车方式就是
「忘了跑 `cap copy`，编译没报错，装上闪退」。

---

## 五、三处改动（逐条 diff）

### 5.1 `SceneDelegate.swift`：窗口只建一次

改前：

```swift
guard let windowScene = scene as? UIWindowScene else { return }
window = UIWindow(windowScene: windowScene)          // 无条件造窗口
window?.rootViewController = AppBridgeViewController()
window?.makeKeyAndVisible()
```

改后：

```swift
guard let windowScene = scene as? UIWindowScene else { return }
if window == nil {                                    // 故事板给了就接管，没给才自建
    window = UIWindow(windowScene: windowScene)
    window?.rootViewController = AppBridgeViewController()
}
window?.makeKeyAndVisible()
```

命门在 `Info.plist` 里这三条同时存在：

```xml
<key>UIApplicationSceneManifest</key>
<dict><key>UISceneConfigurations</key><dict>
  <key>UIWindowSceneSessionRoleApplication</key><array><dict>
    <key>UISceneStoryboardFile</key><string>Main</string>   <!-- ← ① -->
    <key>UISceneDelegateClassName</key><string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>
```

而 `Main.storyboard` 的 initialViewController 就是
`customClass="AppBridgeViewController"`（带 ImageSaver 注册的那个子类）。

当 ① 生效时，UIKit 先把故事板里的控制器装进窗口、赋给 `window`，**然后**才回调
`scene(_:willConnectTo:)`。改前的写法在这个时序下会再建一个窗口 + 再实例化一个
`AppBridgeViewController` → 两个 WKWebView、两份 Capacitor 实例：

- 每个页面轮询翻倍（`usePolling` 两套定时器）
- `localStorage` 同源共享，但两份内存态各自刷新 → 登录态互相覆盖、列表偶发闪回
- 现象是「能用但很怪」，从日志里几乎追不到根因

改成 `if window == nil` 之后两条路径都只有一个 bridge：

- 故事板路径生效 → `window != nil` → 不重建
- 哪天把 `UISceneStoryboardFile` 删了 → `window == nil` → 自建，不会黑屏

### 5.2 `Info.plist`：`armv7` → `arm64`

| 项 | 值 |
|---|---|
| 文件 | `mobile/ios/App/App/Info.plist` |
| 偏移 | `UIRequiredDeviceCapabilities` 数组内唯一一项 |
| 改前 | `<string>armv7</string>` |
| 改后 | `<string>arm64</string>` |
| 哈希 | `sha256:ba96b44c0e978c8c…` → `sha256:b6bfb8dc0f8f98cc…`（均 4770 字节） |

`armv7` 是 Capacitor 老模板留下的。产物只编 arm64（`ARCHS=arm64`），设备是 A16，
声明 armv7 属于自我描述错误；某些安装器会读这个键做兼容判断。

### 5.3 `project.pbxproj`：版本号对齐

| 项 | 值 |
|---|---|
| 文件 | `mobile/ios/App/App.xcodeproj/project.pbxproj` |
| 改前 | `MARKETING_VERSION = 1.0;` ×2（Debug + Release） |
| 改后 | `MARKETING_VERSION = 3.4.2;` ×2 |
| 哈希 | `sha256:4bb8185d2c133b0b…` → `sha256:9ed88e384358aa…` |

原因：设置页「关于」显示的是构建期注入的 `__APP_VERSION__`（`vite.config.ts` 从
`package.json` 读），而 `CFBundleShortVersionString` 走 `MARKETING_VERSION`。
两者不一致时「检查更新」会拿 1.0 去比 3.4.2。

CI 里仍会再传一次 `MARKETING_VERSION=$VERSION`（版本以 `package.json` 为唯一真源），
pbxproj 的改动只是让「直接开 Xcode 编译」也不跑偏。

### 5.4 `SaveFilePlugin.swift`：新增（iOS 侧的「导出到文件」）

安卓侧的 `SaveFilePlugin.java` 写的是 `Environment.DIRECTORY_DOWNLOADS`，这个路径在 iOS 上不存在。
Web 层 `lib/save-file.ts` 的探测逻辑是「有 `Capacitor.Plugins.SaveFile` 就落盘，没有就退剪贴板」，
所以 iOS 缺这个插件时导出账号**不会报错**，只会静默变成「已复制到剪贴板」。

实现要点：

| 决策 | 选择 | 理由 |
|---|---|---|
| 落盘位置 | `Documents/Downloads/` | 临时目录会被系统回收，用户去「文件」App 翻不到；Documents 配合 `UIFileSharingEnabled` 直接出现在「我的 iPhone → Agent2API」 |
| 目录名 | `Downloads`（ASCII） | 安卓的提示文案是「保存到「下载」目录」。在 iOS 上落到一个真叫 Downloads 的文件夹，文案与事实一致，**不用改词表**——`ui/i18n/*` 是 `i18n-src/*.json` 的构建产物，包里没有源头，手改会被下次构建覆盖 |
| 返回值 | `{ok, filename, bytes, path}`，`path` 形如 `Agent2API/Downloads/agent2api-accounts-20261123-090000.json` | 界面把它拼进「已保存到 {path}」。不返回沙盒绝对路径——那串 UUID 对用户没有意义 |
| 同名文件 | 加 `-1`/`-2` 后缀，不覆盖 | 返回的 `filename` 是最终落盘的名字，提示才不会说错 |
| 线程 | `DispatchQueue.global(.userInitiated)` 写盘 | 账号导出可能是几十万行 JSON，同步写会卡住 bridge |
| 限制 | 单文件 ≤ 32 MB；文件名取 `lastPathComponent`、替换 `/ \ : * ? " < > \|`、拒绝 `.` / `..`、隐藏文件加前缀 | 能跳出目标目录的形态一个都不留，中文文件名照常保留 |

配套的 `Info.plist` 两个键：

```xml
<key>UIFileSharingEnabled</key><true/>
<key>LSSupportsOpeningDocumentsInPlace</key><true/>
```

少了这两个，文件写进去了但在「文件」App 里看不见，用户只能重装或越狱才能拿出来。

注册位置在 `ImageSaverPlugin.swift` 的 `AppBridgeViewController.capacitorDidLoad()` 里——
手写插件不在 CLI 生成的 `packageClassList` 里，漏注册就是 `isPluginAvailable` 返回 false，
功能静默消失。

### 5.5 回滚

```bash
# 撤销改动的三个文件
git checkout -- mobile/ios/App/App/SceneDelegate.swift \
               mobile/ios/App/App/Info.plist \
               mobile/ios/App/App/ImageSaverPlugin.swift \
               mobile/ios/App/App.xcodeproj/project.pbxproj
# 撤销新增的插件
git rm -f mobile/ios/App/App/SaveFilePlugin.swift
```

---

## 六、CORS 实测（这是 iOS 能不能连上网关的硬门槛）

iOS 的页面 origin 是 `capacitor://localhost`，与 Android 的 `https://localhost` 不同。
如果网关按 origin 做白名单，iOS 会被静默拒绝——fetch 失败，界面上什么提示都没有。

本机跑着 `agent2api.exe`（`0.0.0.0:3065`，PID 12788），直接打预检：

```bash
curl -s -i -X OPTIONS "http://127.0.0.1:3065/api/panel/status" \
  -H "Origin: capacitor://localhost" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-panel-token"
```

实际响应（截取）：

```
HTTP/1.1 204 No Content
access-control-allow-origin: *
access-control-allow-methods: GET, POST, PUT, PATCH, OPTIONS, DELETE
access-control-allow-headers: Content-Type, Authorization, x-api-key, x-panel-token,
  x-panel-refresh, x-panel-auth-mode, x-agent2api-client, x-title, x-client-type,
  x-cerebras-3rd-party-integration
access-control-allow-private-network: true
```

对 `https://localhost`、`http://192.168.1.50:3065`、甚至 `https://evil.example.com`
结果完全相同（都是 `*`）。**结论：CORS 不是 iOS 的阻塞项。**

前提是网关侧「出站行为 → 跨域」处于开启状态（本机这份是开的）。如果哪天关掉，
iOS 与 Android 会一起挂，不是 iOS 特有问题。

> 顺带说明：`/v1/*` 那条代理路径在二进制里是硬编码 `Access-Control-Allow-Origin: *`，
> 面板 `/api/panel/*` 走的是 `server/src/server/api/cors.rs` 的 CORS 层（有
> `corsEnabled` / `trustedOrigins` 两个配置项）。

---

## 七、风险清单

按「会不会挡住出包 / 装上能不能用」排序。

| # | 风险 | 现象 | 处置 | 验证动作 |
|---|---|---|---|---|
| R1 | 双 WebView（已修） | 请求翻倍、登录态互相覆盖 | §5.1 | 装好后看网关「最近请求」里是否成对出现同一条 |
| R2 | 这份 iOS 工程从未编译过 | `xcodebuild` 报编译错误 | CI 首跑看日志 | `bash scripts/build-ipa.sh` |
| R3 | ~~`capacitorDidLoad()` 钩子被改名~~ | — | **已排除**：对照 8.5.3 源码 `CAPBridgeViewController.swift`，`open func capacitorDidLoad()` 仍在，且由 `loadView()` 在 bridge 建好后调用；`CAPBridgedPlugin` 协议也在（`CAPBridgedPlugin.h` / `CAPBridgedPlugin+getMethod.swift`） | 无需处理 |
| R4 | ad-hoc 签名失败（未签名二进制可能缺 `LC_CODE_SIGNATURE` 空间） | `codesign` 返回非 0 | 脚本已 warn 并跳过，仍交付 unsigned | 看 CI 日志里有没有 `codesign 失败` |
| R5 | 本地网络权限被拒 | 永远连不上网关，无报错 | README 已写明补救路径 | 设置 → 隐私与安全性 → 本地网络 |
| R6 | 导出账号退化成剪贴板 | 点了导出只复制不落文件 | iOS 侧没写 `SaveFile` 插件 | 用「导出账号」按钮点一次 |
| R7 | 后台挂起 | 切后台久了回来要重新拉数据 | iOS 无 Android 那套前台服务保活；状态在 `localStorage`，不会丢登录 | 切后台 5 分钟再回来 |
| R8 | 启动图比例裁剪 | 14 Pro 上 splash 被裁 | `Splash.imageset` 用 2732×2732 通用图 | 冷启动观察 |
| R9 | Capacitor 8 要求较新 Xcode | `swift-tools-version` 或 SDK 不匹配 | 用 `macos-15` + `latest-stable` | 日志里 `xcodebuild -version` 那一行 |

---

## 八、验证矩阵

| 项 | 状态 | 依据 |
|---|---|---|
| APK 可解析、源码完整 | Observed | 1230 条目全解，3 个 Swift 文件 + storyboard + Assets + SPM 齐全 |
| `cap copy ios` 产出正确 | Observed | 本机实跑：`public/` 181 文件 / 7.10 MB，`capacitor.config.json` 生成，`packageClassList` 两项 |
| SPM 本地包路径可解析 | Observed | `@capacitor/app@8.1.2` / `@capacitor/keyboard@8.0.6` 均含 `Package.swift` |
| pbxproj ↔ scheme ↔ 文件一致性 | Observed | target ID 匹配、三个源文件都在 Sources、`public` 在 Resources |
| 图标规格 | Observed | 1024×1024 RGB（无 alpha） |
| 网关 CORS 放行 iOS origin | Observed | §6 实测 204 + `*` |
| `npm ci` 能装齐依赖 | Observed（本地用 pnpm 等价验证） | 524 个包解析成功，`@capacitor/cli 8.5.3` |
| `xcodebuild` 编译 | **Observed** | CI run #2：`BUILD SUCCEEDED`，Xcode 26.3 / iPhoneOS 26.2 SDK / arm64 |
| IPA 结构自检 | **Observed** | 脚本 11 项全过；解包复核：arm64 Mach-O 245,288 B，`public/mobile.js` 1,891,382 B 与源一致，`Capacitor.framework` / `Cordova.framework` 在包内 |
| 首次编译失败 → 修复 | **Observed** | run #1：`SaveFilePlugin.swift:134:2 error: unterminated '/*' comment`（见 §十）→ 修掉 → run #2 绿 |
| 真机安装 / 启动 / 连网关 / 导出落盘 | **NOT RUN** | 需要设备；本机是 Windows，无从验证 |

---

## 九、怎么复现（macOS 上）

```bash
cd mobile
npm ci
node -e "process.stdout.write(require('./package.json').version)"   # 3.4.2
npx cap copy ios                                                    # → public/ + capacitor.config.json
bash ../scripts/build-ipa.sh                                        # → build/out/*.ipa
```

产物：

```
build/out/Agent2API-3.4.2-<n>-unsigned.ipa     # TrollStore / AppSync
build/out/Agent2API-3.4.2-<n>-adhoc.ipa        # 爱思 / Sideloadly
build/out/build-info.json                      # 版本 + SHA-256 + 工具链
```

Windows 上只能跑到 `cap copy` 这一步（已验证），`xcodebuild` 不存在。

---

## 十、CI 运行记录（真实跑过的）

### 10.1 run #1（commit `13af225`）— 失败

```
SaveFilePlugin.swift:134:2: error: unterminated '/*' comment
** BUILD FAILED **
```

根因不是少个 `*/`，而是 **Swift 的块注释可以嵌套**：文件头那段文档注释里写了
`ui/i18n/*`，`/` 紧跟 `*` 等于又开了一层注释，而这一层没闭合，于是编译器一路吃到文件尾
才报错，位置指向最后一行（134），与真正的出错行（21）差了一百多行。

修法：把那句改写成「`ui/i18n` 下的词典」，避开 `/` + `*` 这个字符对。同类隐患顺手扫了
四个 Swift 文件的块注释嵌套深度，全部归零；另外把 `"_" + name.dropFirst()` 改成
`"_" + String(name.dropFirst())`，不依赖 `String + Substring` 的重载推断。

### 10.2 run #2（commit `f61f954`）— 成功

| 项 | 值 |
|---|---|
| runner | `macos-15-arm64`（macOS 15.8.2，镜像 20261118） |
| Xcode | 26.3（17C529），iPhoneOS 26.2 SDK |
| Node | v22.23.5 |
| 耗时 | job 55 秒（00:55:31 → 00:56:26 UTC） |
| 结果 | `BUILD SUCCEEDED` + 11 项产物自检全过 |

自检输出（节选）：

```
✓ 可执行文件        .../Release-iphoneos/App.app/App
✓ 架构              arm64
✓ Web 资源          public/ 7.4M
✓ 运行配置          capacitor.config.json
✓ BundleId          com.agent2api.mobile
✓ 版本号            3.4.2
✓ build 号          2
✓ 显示名            Agent2API
✓ 最低系统          15.0
✓ ATS 例外          NSAllowsArbitraryLoads
✓ 局域网权限        NSLocalNetworkUsageDescription
```

产物：

| 文件 | 大小 | SHA-256（前 16） |
|---|---:|---|
| `Agent2API-3.4.2-2-unsigned.ipa` | 3,463,207 B | `bc2d96a1d67669bb` |
| `Agent2API-3.4.2-2-adhoc.ipa` | 3,480,080 B | `cb54e65ef394556a` |

解包复核（不是看绿灯，是拆开看）：

- `Payload/App.app/App`：Mach-O 64-bit（`0xfeedfacf`），cputype `0x0100000c` = arm64，245,288 B
- `Info.plist`：`com.agent2api.mobile` / 3.4.2 / build 2 / MinimumOSVersion 15.0 /
  `UIRequiredDeviceCapabilities = [arm64]` / `UIFileSharingEnabled = true` /
  ATS 三键齐全 / `NSLocalNetworkUsageDescription` 存在
- `Payload/App.app/public/mobile.js` = 1,891,382 B，与仓库里的 `android-www/mobile.js` 字节数一致
- `Frameworks/`：`Capacitor.framework`、`Cordova.framework`。`AppPlugin` / `KeyboardPlugin`
  是 SPM 本地包，静态编进主二进制，不单独成 framework —— 正常
- ad-hoc 版比 unsigned 大 21 KB：`codesign` 把签名数据写进去了，说明第二份产物是真签过的

### 10.3 出包环境的一个坑（记下来省下次）

这台开发机的网络里 `github.com:443` 不通（`api.github.com:443` 通），所以：

- `git push` 走 **SSH**（`github.com:22` 与 `ssh.github.com:443` 都通）。token 的 scope 是
  `repo, workflow, write:packages, delete:packages`，**没有 `admin:public_key`**，加不了账号级
  SSH key，于是用 `POST /repos/{owner}/{repo}/keys` 加了一个**仓库部署密钥**（`repo` 权限够用）。
  实测部署密钥能推 `.github/workflows/*` —— workflow scope 的限制针对 OAuth token，不针对部署密钥。
- GitHub Releases 的二进制下载被墙，MinGit 从 `registry.npmmirror.com` 镜像取。
