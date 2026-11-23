# Agent2API · iOS 版（IPA 自动构建）

把 `Agent2API-3.4.2-安卓版.zip` 里的这套工程，做成能在 iPhone 上装、并且由 GitHub Actions
自动出 IPA 的仓库。

**结论：能打，而且不用从零移植。** 源码里本来就带一份完整的 Capacitor 8 iOS 工程
（`mobile/ios/App`，bundle id `com.agent2api.mobile`），只是从来没编译过、也没出过包。
这个仓库补的就是「编译 → 打包 → 分发」这一段。

---

## 一、这套工程是什么

一个 Capacitor 应用，三层：

| 层 | 位置 | 内容 | iOS 复用 |
|---|---|---|---|
| Web 界面 | `mobile/src`（React 19 + Tailwind v4）→ `vite build --mode apk` → `mobile/android-www/` | 单文件 IIFE（`mobile.js` 1.89 MB）+ 5 套词典 + 提供商图标，全部相对路径 | **100%**，原样打进 WKWebView |
| 原生壳 | `mobile/ios/App`（Swift + Capacitor 8.5.3，SPM） | WebView 宿主、`ImageSaverPlugin`（保存助手图片）、SceneDelegate | 已有，未编译 |
| 原生壳（Android） | `mobile/android`（Gradle + JDK 21） | 保活前台服务、`SaveFile`、`ApkUpdater`、下拉磁贴 | iOS 用不上 |
| 网关 | 你电脑上的 `agent2api.exe`（默认 3065） | 提供 `/api/*` | 不变 |

关键点：**Web 层早就按 iOS 写过分支**。`lib/servers.ts` 的 `nativePlatform()` 会返回 `'ios'`，
更新面板在 iOS 上只跳 GitHub Release、`save-file.ts` 探测不到原生插件就退剪贴板、
`capacitor.config.ts` 里连「iOS 为什么不能用 https scheme」都写清楚了。所以这不是移植，
是**补一条出包链路**。

## 二、我改了什么

只有三处，都在原生层。每处都写明了原因，附在文件注释里。

| 文件 | 改前 | 改后 | 为什么 |
|---|---|---|---|
| `mobile/ios/App/App/SceneDelegate.swift` | 无条件 `window = UIWindow(...)` | `if window == nil` 才自建 | `Info.plist` 里同时有 `UISceneStoryboardFile = Main`，UIKit 会先把故事板里的 `AppBridgeViewController` 装进窗口再回调本方法；再建一个就是**两个 CAPBridgeViewController**——两个 WKWebView、请求翻倍、登录态互相覆盖，且极难从现象追回原因 |
| `mobile/ios/App/App/Info.plist` | `<string>armv7</string>` | `<string>arm64</string>` | 二进制只产 arm64；`armv7` 是 Capacitor 模板遗留（老 Xcode 时代） |
| `mobile/ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION = 1.0`（两处） | `3.4.2`（两处） | 设置页「关于」显示的是构建期注入的 `__APP_VERSION__`（来自 `package.json`），plist 里写 1.0 会让版本检查自己跟自己打架 |

Android 侧一行没动。`android2api-release.jks` 与 `keystore.properties` **没有进仓库**
（`.gitignore` 拦掉），iOS 构建也不需要它们。

## 三、出包

### 方式 1：GitHub Actions（推荐，不需要 Mac）

**第一次推上去：**

```bash
cd a2api-ios
git init -b main
git add .
git commit -m "Agent2API iOS：补齐 IPA 构建链路"
gh repo create agent2api-ios --private --source=. --push
# 没装 gh：在网页上建空仓库，然后
#   git remote add origin git@github.com:<你>/agent2api-ios.git && git push -u origin main
```

推完去 Actions 页确认 `iOS IPA` 跑过一轮（push 触发的第一轮会跑，因为 paths 里有
`mobile/ios/**`）。红了就把日志贴回来。

推到 GitHub 之后：

- **手动**：Actions → `iOS IPA` → Run workflow。可选勾「从源码重建 Web 产物」。
- **自动**：push 到 `main` 且改动涉及 iOS 工程 / 打包脚本时自动跑。
- **发版**：`git tag v3.4.2 && git push origin v3.4.2` → 跑完自动建 Release，IPA 挂在附件里，
  手机上能直接点链接用 TrollStore 打开。

产物（artifact 里两个都给了）：

| 文件 | 用途 |
|---|---|
| `Agent2API-3.4.2-<n>-unsigned.ipa` | 未签名。TrollStore / 巨魔、AppSync Unified、越狱机 |
| `Agent2API-3.4.2-<n>-adhoc.ipa` | ad-hoc 签名。爱思助手、Sideloadly、部分安装器 |

外加 `build-info.json`（版本、commit、Xcode 版本、两个包的 SHA-256）。

CI 用的 runner 是 `macos-15` + `latest-stable` Xcode，**不需要配任何 Secret**——
全程 `CODE_SIGNING_ALLOWED=NO`，不碰证书。

### 方式 2：本地 macOS

```bash
cd a2api-ios
(cd mobile && npm ci)
bash scripts/build-ipa.sh           # 脚本自己会 cd，仓库根目录直接执行即可
```

要求 Xcode 16+（Capacitor 8 的 SPM 包这么要求）。产物在 `build/out/`。

> Windows 上出不了 iOS 包，别试 —— `xcodebuild` 只有 macOS 有。

## 四、装到 iPhone 14 Pro 上

你的机器是 Relaxin 越狱 + 有巨魔，走 **TrollStore** 这条最省事：

1. 下载 `Agent2API-3.4.2-<n>-unsigned.ipa` 到手机（AirDrop / 文件 App / Safari 直接下）。
2. 用 TrollStore 打开（分享 → 用 TrollStore 打开，或 TrollStore 里「+」选文件）。
3. Install。装完是永久的，不会 7 天掉签。

其他两条路：

- **越狱 + AppSync Unified**：`unsigned.ipa` 直接丢 Filza 点安装，或 `ipainstaller`。AppSync 负责 fakesign。
- **没越狱 / 想用电脑**：Sideloadly、爱思助手，装 `adhoc.ipa`（它们会用你的 Apple ID 证书重签，7 天有效期）。

### 首次打开必须做的一步

会弹「**Agent2API 想要查找并连接本地网络上的设备**」——**必须允许**。
拒绝之后连不上局域网网关，而且不会报错，只会一直 fetch 失败。补救：设置 → 隐私与安全性 →
本地网络 → 找到 Agent2API 打开。

然后填网关地址：

- 主机 = 你电脑的局域网 IP（`ipconfig` 看「IPv4 地址」）
- 端口 = `3065`（界面上有常用端口快捷按钮）
- 保存前会先探活，连不上会当场提示，不会存进去

网关监听地址要是 `0.0.0.0`（桌面端：设置 → 局域网访问 打开；headless：`AGENT2API_HOST=0.0.0.0`），
Windows 防火墙放行 TCP 3065。

## 五、iOS 与 Android 的差异（会遇到的）

| 能力 | Android | iOS | 说明 |
|---|---|---|---|
| 界面 / 全部管理功能 | ✅ | ✅ | 同一份 Web 产物 |
| 连局域网 http 网关 | ✅ | ✅ | iOS 靠 `NSAppTransportSecurity` 三个例外键；CORS 已实测放行 `capacitor://localhost` |
| 导出账号文件到「下载」 | ✅ 原生 `SaveFile` | ⚠️ **退剪贴板** | iOS 侧没写 `SaveFile` 插件，`save-file.ts` 探测不到就走剪贴板 |
| 保存助手生成的图片 | ✅ | ✅ `ImageSaverPlugin`（`UIActivityViewController` 分享面板） | 原生层已实现 |
| 应用内更新（下载安装包） | ✅ `ApkUpdater` | ❌ 只跳到 GitHub Release | 苹果不允许 App 自装可执行代码 |
| 连接保活 / 常驻通知 / 下拉磁贴 / 开机自连 | ✅ | ❌ | Android 前台服务专属 |
| 人机验证的 SHA-256 | `crypto.subtle` | 纯 JS 兜底（慢一点，结果一致） | iOS 页面 origin 是 `capacitor://localhost`，不算安全上下文 |

## 六、验证状态

诚实标注，没跑过的就是没跑过。

| 项 | 状态 | 依据 |
|---|---|---|
| 源码结构 / 依赖链完整性 | **Observed** | 逐文件核对：3 个 Swift 源文件、storyboard、Assets、SPM 依赖、scheme 与 target ID |
| `cap copy ios` 能生成 `public/` 与 `capacitor.config.json` | **Observed** | 本机实跑：181 文件 / 7.10 MB，`packageClassList: [AppPlugin, KeyboardPlugin]` |
| SPM 本地包路径能解析 | **Observed** | `@capacitor/app@8.1.2`、`@capacitor/keyboard@8.0.6` 均带 `Package.swift` |
| 网关对 iOS origin 的 CORS | **Observed** | 实测 `OPTIONS /api/panel/status`，`Origin: capacitor://localhost` → 204 + `access-control-allow-origin: *` |
| 原生层调用的 Capacitor API 在 8.5.3 里存在 | **Observed** | 对照上游 `8.5.3` 源码：`capacitorDidLoad()` 仍在、`CAPBridgedPlugin` 协议仍在 |
| `xcodebuild` 能编译通过 | **NOT RUN** | 本机是 Windows，无 Xcode；等 CI 首跑 |
| IPA 能在真机装上并启动 | **NOT RUN** | 需要你在手机上试 |
| 首屏是否白屏 / 双 WebView | **Inferred 已修** | 见 SceneDelegate 改动；若仍异常，回滚只需恢复那 3 行 |

## 七、目录

```
.
├─ .github/workflows/
│  ├─ ios-ipa.yml          # 手动 / push 出包 + artifact
│  └─ ios-release.yml      # tag 出包 + GitHub Release
├─ scripts/build-ipa.sh    # 唯一的构建入口（本地与 CI 共用）
├─ mobile/                 # Capacitor 工程（web 源码 + ios/ + android/）
│  ├─ ios/App/             # ← iOS 原生工程
│  └─ android-www/         # web 产物（cap copy 的输入，也是 APK 用的那份）
├─ ui-kit/ ui-shared/      # web 源码引用的共享库
├─ ui/ ui-islands/         # 桌面端前端（仅 rebuild_web 时用到）
└─ docs/iOS-移植分析.md     # 详细技术分析
```

## 八、下一步（要不要做，你定）

1. **CI 首跑**：推上去跑一次，把 `xcodebuild` 的报错贴回来，我按日志改。
2. **补 iOS 的 `SaveFile` 插件**：让「导出账号」在 iPhone 上也能落文件（现在退剪贴板）。
   改动量约 60 行 Swift + 注册到 `AppBridgeViewController`。
3. **给 IPA 加图标缓存 / 启动图适配**：目前 `Splash.imageset` 用的是 2732×2732 通用图，
   在 14 Pro 的比例下会被裁，可换成按机型分层。
