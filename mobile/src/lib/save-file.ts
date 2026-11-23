/**
 * 把文本写成文件，落到用户能找到的地方（「下载」目录）。
 *
 * ── 为什么单独一层而不是直接调插件 ───────────────────────────
 * 三个原因，每个都会在真机上出事：
 *   1. 浏览器 / PWA 里没有原生插件，直接 `Capacitor.Plugins.SaveFile` 会是
 *      undefined，点一下白屏。这里先探测再用。
 *   2. WebView 的 `a[download]` 在多数 Android WebView 里不触发下载，靠它兜底
 *      会「看起来成功、其实什么都没存」。所以浏览器形态退回剪贴板。
 *   3. 保存成功要让用户知道**存到哪了** —— 路径由原生返回，不该在 JS 里猜。
 *
 * ── 返回值语义 ──────────────────────────────────────────────
 * `{ mode: 'file', path }` —— 真落盘了；
 * `{ mode: 'clipboard' }`  —— 没有原生能力，内容已进剪贴板，由用户自己粘贴保存。
 * 调用方据此给不同文案，不要假装两种情况一样。
 */

export type SaveResult =
  | { mode: 'file'; path: string; filename: string; bytes: number }
  | { mode: 'clipboard' }

type SaveFilePlugin = {
  save(options: { filename: string; content: string; mime?: string }): Promise<{
    ok?: boolean
    path?: string
    filename?: string
    bytes?: number
  }>
}

function nativePlugin(): SaveFilePlugin | null {
  if (typeof window === 'undefined') return null
  const capacitor = (window as Window & {
    Capacitor?: {
      isNativePlatform?: () => boolean
      Plugins?: Record<string, unknown>
    }
  }).Capacitor
  if (!capacitor?.isNativePlatform?.()) return null
  const plugin = capacitor.Plugins?.SaveFile as SaveFilePlugin | undefined
  return plugin && typeof plugin.save === 'function' ? plugin : null
}

/** 插件是否可用（用于 UI 上区分「保存到下载」和「复制」两种按钮文案）。 */
export function canSaveFile(): boolean {
  return nativePlugin() !== null
}

/** 写剪贴板：`navigator.clipboard` 在非安全上下文里没有，退回 execCommand。 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

/**
 * 保存文本。有原生插件就落盘，否则进剪贴板。
 *
 * 注意：**不**在这里做成功提示，文案归调用方 —— 不同场景（导出账号 / 导出配置）
 * 要说的不是同一句话。
 */
export async function saveTextFile(
  filename: string,
  content: string,
  mime = 'application/json',
): Promise<SaveResult> {
  const plugin = nativePlugin()
  if (plugin) {
    const result = await plugin.save({ filename, content, mime })
    return {
      mode: 'file',
      path: result.path || filename,
      filename: result.filename || filename,
      bytes: result.bytes ?? content.length,
    }
  }
  const copied = await copyToClipboard(content)
  if (!copied) throw new Error('当前环境既不能写文件，也不能访问剪贴板')
  return { mode: 'clipboard' }
}

/** 读剪贴板（导入用）。拿不到就返回空串，由用户手动粘贴。 */
export async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}
