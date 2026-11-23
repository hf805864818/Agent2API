#!/usr/bin/env node
/*
 * APK 打包流水线（在 desktop-tauri/mobile 下执行：node make-apk.mjs）
 * ────────────────────────────────────────────────────────────────
 * 为什么不能只跑 `npm run build:apk`
 *
 * `vite build --mode apk` 用 esbuild 按 target=es2019 出包，只降语法到
 * ES2019 为止；而 APK 跑在系统 WebView 里，WebView 由用户自行更新，
 * 出厂即停更的机器可能停在 Chrome 60 一代。ES2019 产物里的
 * Object.hasOwn / Array.prototype.at 在那种环境是 undefined，脚本一抛
 * 错 React 就不挂载 —— 表现就是"装上了，点开是白屏"。
 *
 * 所以这里做三步：
 *   1) vite 出包（产物落 android-www/）
 *   2) babel 按 chrome 60 再降一遍语法（?. / ?? / 可选 catch 绑定等）
 *   3) 静态检查：产物必须能以 ES5 解析，且不残留未 polyfill 的新 API
 * 第 3 步失败会直接退出，不让半成品进 APK。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const webDir = path.join(here, 'android-www')
const require = createRequire(path.join(here, 'package.json'))

const log = (msg) => console.log(`\x1b[36m[apk]\x1b[0m ${msg}`)
const die = (msg) => {
  console.error(`\x1b[31m[apk] ${msg}\x1b[0m`)
  process.exit(1)
}

/* ── 1. vite 出包 ───────────────────────────────────────────── */
log('vite build --mode apk')
execFileSync(process.execPath, [path.join(here, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'apk'], {
  cwd: here,
  stdio: 'inherit',
})

/* ── 2. babel 二次降级 ──────────────────────────────────────── */
// 只处理经典脚本（非 module、按 <script src> 直接加载）。mobile.js 是
// vite 出的 IIFE，也在其中。
const staticScripts = ['mobile.js', 'i18n.js', 'aliyun-captcha.js', 'apk-polyfill.js']

let babel = null
let presetEnv = null
try {
  // @babel/core 8 是纯 ESM 且没有 default 导出，@babel/preset-env 有 —— 两种都兜住
  const coreNs = await import('file://' + path.join(here, 'node_modules', '@babel', 'core', 'lib', 'index.js'))
  babel = typeof coreNs.transformSync === 'function' ? coreNs : coreNs.default
  const envNs = await import('file://' + path.join(here, 'node_modules', '@babel', 'preset-env', 'lib', 'index.js'))
  presetEnv = typeof envNs.default === 'function' || typeof envNs.default === 'object' ? envNs.default : envNs
} catch {
  babel = null
}

if (!babel || !presetEnv) {
  log('未安装 @babel/core + @babel/preset-env，跳过二次降级（产物仍是 ES2019）')
  log('  想兼容老 WebView：npm i -D @babel/core @babel/preset-env')
} else {
  for (const name of staticScripts) {
    const file = path.join(webDir, name)
    if (!fs.existsSync(file)) continue
    const raw = fs.readFileSync(file, 'utf8')
    let out = null
    try {
      out = babel.transformSync(raw, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceType: 'script',
        comments: true,
        compact: false,
        presets: [[presetEnv, { targets: { chrome: '60' }, modules: false, useBuiltIns: false }]],
      })
    } catch (err) {
      die(`babel 降级 ${name} 失败：${err && err.message}`)
    }
    if (!out || typeof out.code !== 'string') die(`babel 未产出代码：${name}`)
    fs.writeFileSync(file, out.code, 'utf8')
    log(`${name}: ${raw.length} → ${out.code.length} 字节`)
  }
}

/* ── 3. 静态检查 ────────────────────────────────────────────── */
// 用 acorn 以 ES5 语法解析：能过就说明老引擎不会在解析阶段报错。
let acorn = null
try {
  acorn = require('acorn')
} catch {
  acorn = null
}

if (!acorn) {
  log('未安装 acorn，跳过语法检查')
} else {
  const banned = [
    [/\?\.[A-Za-z_$([]/, 'optional chaining (?.)'],
    [/\?\?[^=]/, 'nullish coalescing (??)'],
    [/catch\s*\{/, 'optional catch binding'],
    [/(\|\|=|&&=|\?\?=)/, 'logical assignment'],
  ]
  let failed = 0
  for (const name of staticScripts) {
    const file = path.join(webDir, name)
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, 'utf8')

    for (const [re, label] of banned) {
      if (re.test(src)) {
        console.error(`  ✗ ${name}: 残留 ${label}`)
        failed++
      }
    }

    // 语法门槛按 Chrome 60 的真实解析能力定：它已支持 ES2018（对象展开、
    // 异步生成器），所以 mobile.js 落在 ES2018 是正常的；真正会炸的是
    // `?.` / `??` / 可选 catch 绑定（上面 banned 已拦）。polyfill 必须是
    // 纯 ES5 —— 它在最前面执行，自己先炸就没人兜底了。
    let level = null
    for (const v of [5, 2015, 2016, 2017, 2018, 2019, 2020]) {
      try {
        acorn.parse(src, { ecmaVersion: v })
        level = v
        break
      } catch {
        /* 试下一档 */
      }
    }
    if (level === null) {
      console.error(`  ✗ ${name}: 连 ES2020 都解析失败`)
      failed++
      continue
    }
    const floor = name === 'apk-polyfill.js' ? 5 : 2018
    if (level > floor) {
      console.error(`  ✗ ${name}: 语法停在 ES${level}，期望 ≤ ES${floor}`)
      failed++
    } else {
      log(`✓ ${name} 语法 ES${level}`)
    }
  }

  // 校验 polyfill 真的覆盖了产物里用到的新 API：只要产物用了，polyfill 里
  // 就必须出现对应标识符（宽松判断，不做语义分析）
  const polyfill = fs.readFileSync(path.join(webDir, 'apk-polyfill.js'), 'utf8')
  const mobile = fs.readFileSync(path.join(webDir, 'mobile.js'), 'utf8')
  for (const [re, token, label] of [
    [/Object\.hasOwn/, 'hasOwn', 'Object.hasOwn'],
    [/\.flatMap\(/, 'flatMap', 'Array.prototype.flatMap'],
    [/\b[\w$)\]]\.at\(\s*-/, 'at', 'Array.prototype.at（负下标）'],
    [/queueMicrotask/, 'queueMicrotask', 'queueMicrotask'],
  ]) {
    if (re.test(mobile) && !polyfill.includes(token)) {
      console.error(`  ✗ mobile.js 用了 ${label}，但 apk-polyfill.js 没有提供`)
      failed++
    }
  }

  if (failed > 0) die(`静态检查未通过（${failed} 项），不生成 APK`)
  log('静态检查通过')
}

/* ── 4. 提示下一步 ──────────────────────────────────────────── */
log('产物就绪：android-www/')
log('下一步：npx cap sync android && cd android && gradlew.bat assembleRelease')