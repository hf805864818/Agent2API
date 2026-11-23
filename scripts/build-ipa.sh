#!/usr/bin/env bash
#
# Agent2API iOS 打包脚本（unsigned / ad-hoc 双产物）
# ============================================================================
# 在仓库根目录执行：bash scripts/build-ipa.sh
#
# 前置（CI 里由 workflow 装好）：
#   · macOS + Xcode（Capacitor 8 需要 Xcode 16 及以上）
#   · Node 20.19+ / 22.12+，且 `mobile/node_modules` 已装好
#       —— SPM 的本地包路径指向 `mobile/node_modules/@capacitor/{app,keyboard}`，
#          没装依赖时 xcodebuild 会在解析依赖阶段直接失败。
#
# 这个脚本不签名（没有开发者证书也能出包）：
#   · `-unsigned.ipa`：二进制完全未签名，给 TrollStore（巨魔）与
#     AppSync Unified 用 —— 它们在安装时自己做 fakesign。
#   · `-adhoc.ipa`：用 `codesign -s -` 做 ad-hoc 签名，给那些拒绝未签名包的
#     安装器（部分版本的爱思 / Sideloadly）用。
#
# 环境变量（都有默认值，CI 里自动带上）：
#   VERSION         覆盖版本号（默认取 mobile/package.json 的 version）
#   BUILD_NUMBER    覆盖 build 号（默认 GitHub run number，本地取时间戳）
#   OUT_DIR         产物目录（默认 build/out）
#   ARCHS           架构（默认 arm64）
# ============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/mobile"
IOS_APP_DIR="$MOBILE/ios/App"
OUT_DIR="${OUT_DIR:-$ROOT/build/out}"
DERIVED="${DERIVED_DIR:-$ROOT/build/DerivedData}"
ARCHS_WANTED="${ARCHS:-arm64}"

log()  { printf '\033[36m[ipa]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[ipa] %s\033[0m\n' "$*"; }
die()  { printf '\033[31m[ipa] %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. 环境自检 ────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || die "只能在 macOS 上构建 iOS 包（当前：$(uname -s)）"
command -v xcodebuild >/dev/null 2>&1 || die "找不到 xcodebuild，先装 Xcode"
[ -d "$IOS_APP_DIR/App.xcodeproj" ] || die "缺少 iOS 工程：$IOS_APP_DIR/App.xcodeproj"
[ -d "$MOBILE/node_modules/@capacitor/cli" ] || die "mobile/node_modules 未安装，先执行：cd mobile && npm ci"

# ── 1. 版本号 ──────────────────────────────────────────────────────────────
if [ -z "${VERSION:-}" ]; then
  VERSION="$(node -e "process.stdout.write(require('$MOBILE/package.json').version)")"
fi
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-$(date -u +%Y%m%d%H%M)}}"
[ -n "$VERSION" ] || die "取不到版本号"

log "版本 ${VERSION} (build ${BUILD_NUMBER})，产物目录 ${OUT_DIR}"
log "Xcode: $(xcodebuild -version | tr '\n' ' ')"
log "Node : $(node -v)"

mkdir -p "$OUT_DIR"

# ── 2. 把 Web 产物同步进 iOS 工程 ──────────────────────────────────────────
# `cap copy` 做两件事，都需要，缺一个就是白屏或连不上网关：
#   · android-www/ → ios/App/App/public/（界面本体，pbxproj 里已作为 folder
#     reference 挂进 Resources，改完自动进 .app）
#   · 生成 ios/App/App/capacitor.config.json（appId / iosScheme / Keyboard
#     参数等运行时配置，缺失时 Capacitor 会退回默认值）
log "cap copy ios"
cd "$MOBILE"
if command -v npx >/dev/null 2>&1; then
  npx --no-install cap copy ios
else
  node node_modules/@capacitor/cli/bin/capacitor copy ios
fi

[ -f "$IOS_APP_DIR/App/public/index.html" ] || die "public/index.html 没生成，webDir 配置有问题"
[ -f "$IOS_APP_DIR/App/capacitor.config.json" ] || die "capacitor.config.json 没生成"

# ── 3. 编译 ────────────────────────────────────────────────────────────────
# 关签名：CODE_SIGNING_ALLOWED=NO 之后，Automatic 签名与缺失的团队/证书都不再
# 参与，产物是未签名的 .app。这是 TrollStore / 侧载链路的正常形态。
#
# MARKETING_VERSION 从 package.json 注入：设置页「关于」读的是构建期写进包的
# __APP_VERSION__，两个来源必须一致，否则版本检查会自己跟自己打架。
log "xcodebuild build（Release / device / ${ARCHS_WANTED}）"
cd "$IOS_APP_DIR"
xcodebuild build \
  -project App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  ARCHS="$ARCHS_WANTED" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="" \
  PROVISIONING_PROFILE_SPECIFIER="" \
  CAPACITOR_DEBUG=false \
  COMPILER_INDEX_STORE_ENABLE=NO \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  build

APP="$DERIVED/Build/Products/Release-iphoneos/App.app"
[ -d "$APP" ] || die "编译没产出 App.app：$APP"

# ── 4. 打包 IPA ────────────────────────────────────────────────────────────
# Payload/ 是 IPA 的硬性结构；.app 目录名保持 App（与 CFBundleExecutable 一致，
# 改名会导致装不上）。界面上显示的名字来自 Info.plist 的 CFBundleDisplayName。
package_ipa() {
  local src_app="$1" out="$2"
  local stage
  stage="$(mktemp -d)"
  mkdir -p "$stage/Payload"
  cp -R "$src_app" "$stage/Payload/App.app"
  ( cd "$stage" && zip -qry "$out" Payload )
  rm -rf "$stage"
}

IPA_UNSIGNED="$OUT_DIR/Agent2API-${VERSION}-${BUILD_NUMBER}-unsigned.ipa"
log "打包 unsigned IPA"
package_ipa "$APP" "$IPA_UNSIGNED"

IPA_ADHOC="$OUT_DIR/Agent2API-${VERSION}-${BUILD_NUMBER}-adhoc.ipa"
log "打包 ad-hoc 签名 IPA"
ADHOC_APP="$(mktemp -d)/App.app"
cp -R "$APP" "$ADHOC_APP"
# --deep 会把内嵌的 Capacitor.framework 等一起签掉；对纯本地调试用途足够了
codesign --force --deep --sign - --timestamp=none "$ADHOC_APP" 2>/dev/null \
  || warn "codesign 失败，只交 unsigned 产物"
if codesign -dv "$ADHOC_APP" >/dev/null 2>&1; then
  package_ipa "$ADHOC_APP" "$IPA_ADHOC"
else
  warn "ad-hoc 签名校验没过，跳过该产物"
  IPA_ADHOC=""
fi
rm -rf "$(dirname "$ADHOC_APP")"

# ── 5. 产物自检 ────────────────────────────────────────────────────────────
# 每次构建都验一遍，避免把「编出来了但装不进去」的包发出去。
log "产物自检"
FAIL=0
check() { # name condition detail
  if eval "$2"; then printf '  ✓ %-22s %s\n' "$1" "$3"
  else printf '  ✗ %-22s %s\n' "$1" "$3"; FAIL=$((FAIL+1)); fi
}
check "可执行文件" "[ -f '$APP/App' ]" "$APP/App"
check "架构" "[ \"\$(lipo -archs '$APP/App')\" = '${ARCHS_WANTED}' ]" "$(lipo -archs "$APP/App" 2>/dev/null || echo '?')"
check "Web 资源" "[ -f '$APP/public/index.html' ] && [ -f '$APP/public/mobile.js' ]" "public/ $(du -sh "$APP/public" | cut -f1)"
check "运行配置" "[ -f '$APP/capacitor.config.json' ]" "capacitor.config.json"
check "BundleId" "plutil -extract CFBundleIdentifier raw '$APP/Info.plist' | grep -qx 'com.agent2api.mobile'" "$(plutil -extract CFBundleIdentifier raw "$APP/Info.plist")"
check "版本号" "plutil -extract CFBundleShortVersionString raw '$APP/Info.plist' | grep -qx '$VERSION'" "$(plutil -extract CFBundleShortVersionString raw "$APP/Info.plist")"
check "build 号" "plutil -extract CFBundleVersion raw '$APP/Info.plist' | grep -qx '$BUILD_NUMBER'" "$(plutil -extract CFBundleVersion raw "$APP/Info.plist")"
check "显示名" "plutil -extract CFBundleDisplayName raw '$APP/Info.plist' | grep -qx 'Agent2API'" "$(plutil -extract CFBundleDisplayName raw "$APP/Info.plist")"
check "最低系统" "plutil -extract MinimumOSVersion raw '$APP/Info.plist' | grep -qx '15.0'" "$(plutil -extract MinimumOSVersion raw "$APP/Info.plist")"
check "ATS 例外" "plutil -extract NSAppTransportSecurity.NSAllowsArbitraryLoads raw '$APP/Info.plist' | grep -qx 'true'" "NSAllowsArbitraryLoads"
check "局域网权限" "plutil -extract NSLocalNetworkUsageDescription raw '$APP/Info.plist' | grep -q ." "NSLocalNetworkUsageDescription"
[ "$FAIL" -eq 0 ] || die "产物自检有 $FAIL 项未通过"
log "产物自检全通过"

# ── 6. 汇总 ────────────────────────────────────────────────────────────────
SUMMARY="$OUT_DIR/build-info.json"
{
  printf '{\n'
  printf '  "app": "Agent2API",\n'
  printf '  "bundleId": "com.agent2api.mobile",\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "build": "%s",\n' "$BUILD_NUMBER"
  printf '  "arch": "%s",\n' "$ARCHS_WANTED"
  printf '  "minIOS": "15.0",\n'
  printf '  "xcode": "%s",\n' "$(xcodebuild -version | head -1)"
  printf '  "node": "%s",\n' "$(node -v)"
  printf '  "commit": "%s",\n' "${GITHUB_SHA:-local}"
  printf '  "builtAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "files": [\n'
  first=1
  for f in "$IPA_UNSIGNED" ${IPA_ADHOC:+"$IPA_ADHOC"}; do
    [ -n "$first" ] || printf ',\n'
    first=""
    printf '    {"name": "%s", "bytes": %s, "sha256": "%s"}' \
      "$(basename "$f")" "$(stat -f%z "$f")" "$(shasum -a 256 "$f" | cut -d' ' -f1)"
  done
  printf '\n  ]\n}\n'
} > "$SUMMARY"

log "产物："
for f in "$IPA_UNSIGNED" ${IPA_ADHOC:+"$IPA_ADHOC"} "$SUMMARY"; do
  printf '  %-58s %8s  %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)" "$(shasum -a 256 "$f" | cut -c1-16)"
done

# GitHub Actions 任务摘要（本地跑时 GITHUB_STEP_SUMMARY 为空，跳过）
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '## Agent2API iOS %s (build %s)\n\n' "$VERSION" "$BUILD_NUMBER"
    printf '| 产物 | 大小 | SHA-256（前 16） |\n|---|---|---|\n'
    for f in "$IPA_UNSIGNED" ${IPA_ADHOC:+"$IPA_ADHOC"}; do
      printf '| `%s` | %s | `%s` |\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)" "$(shasum -a 256 "$f" | cut -c1-16)"
    done
    printf '\n安装：TrollStore 装 `-unsigned`；爱思 / Sideloadly 装 `-adhoc`。\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
