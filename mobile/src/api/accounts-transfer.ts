import { apiCall } from './client'

/**
 * 账号导出 / 导入。
 *
 * ── 契约（对 server/api/accounts.rs + core/account_transfer.rs 核过）────
 * `GET  /api/accounts/export` → `{ version, exportedAt, customProviders, accounts }`
 * `POST /api/accounts/import` ← 同一个结构（顶层必须有 accounts 数组）
 *      → `{ total, added, updated, skipped, failed, errors, customProviders }`
 *
 * 网关对「信封壳」（`{success, data:{accounts}}`）也兼容，会自己下钻一层，
 * 所以旧文件导回去不会失败。
 *
 * ── 为什么导出要连 customProviders 一起带 ────────────────────
 * 账号记录的 `provider` 字段指向这些自定义提供商定义（外键）。只导账号不导定义，
 * 导到另一台机器上那些账号会指向不存在的提供商，等于导入了一堆废数据。
 * 网关的 import 会先合并 customProviders 再合并账号，顺序已经处理好。
 */

export type AccountExportRecord = Record<string, unknown>

export type AccountExportBundle = {
  version?: number | string
  exportedAt?: number
  customProviders?: unknown[]
  accounts: AccountExportRecord[]
}

export type AccountImportResult = {
  total?: number
  added?: number
  updated?: number
  skipped?: number
  failed?: number
  errors?: Array<{ id?: string; message?: string; customProvider?: boolean }>
  customProviders?: { added?: number; updated?: number } | number
}

export function exportAccounts(signal?: AbortSignal): Promise<AccountExportBundle> {
  return apiCall<AccountExportBundle>('/api/accounts/export', { signal })
}

export function importAccounts(bundle: AccountExportBundle): Promise<AccountImportResult> {
  return apiCall<AccountImportResult>('/api/accounts/import', { method: 'POST', body: bundle })
}

/**
 * 解析用户粘贴/选中的文本，得到可提交的 bundle。
 *
 * 只做**形状**校验，不猜内容：`accounts` 必须是数组，元素必须是对象。其余字段
 * 原样透传 —— 网关自己会忽略不认识的键，这里多删反而会丢信息。
 * 也接受 `{success, data:{accounts}}` 信封，与网关的兼容范围一致。
 */
export function parseExportBundle(text: string): AccountExportBundle {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('内容为空，先粘贴导出的 JSON')

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('不是有效的 JSON，检查是否粘贴完整')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('顶层必须是 JSON 对象')
  }

  const root = parsed as Record<string, unknown>
  // 信封壳：顶层没有 accounts，但 data.accounts 存在
  const source = Array.isArray(root.accounts)
    ? root
    : (root.data && typeof root.data === 'object' && Array.isArray((root.data as Record<string, unknown>).accounts)
      ? (root.data as Record<string, unknown>)
      : root)

  const accounts = source.accounts
  if (!Array.isArray(accounts)) throw new Error('缺少 accounts 数组，这个文件不是账号导出文件')
  if (accounts.length === 0) throw new Error('accounts 为空，没有可导入的账号')
  const bad = accounts.findIndex(item => !item || typeof item !== 'object' || Array.isArray(item))
  if (bad >= 0) throw new Error(`第 ${bad + 1} 个账号不是对象，文件可能被改坏了`)

  return source as AccountExportBundle
}

/** 导出文件名：带时间戳，避免连续导出互相覆盖。 */
export function exportFilename(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `agent2api-accounts-${stamp}.json`
}

/** 把导入结果压成一句能直接显示的话。 */
export function describeImportResult(result: AccountImportResult): string {
  const parts: string[] = []
  if (result.added) parts.push(`新增 ${result.added}`)
  if (result.updated) parts.push(`更新 ${result.updated}`)
  if (result.skipped) parts.push(`跳过 ${result.skipped}`)
  if (result.failed) parts.push(`失败 ${result.failed}`)
  return parts.length ? parts.join(' · ') : '没有变化'
}
