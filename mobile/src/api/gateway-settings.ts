/**
 * 网关侧「出站内容处理」的四组设置。
 *
 * 契约逐字段对齐后端（`server/src/server/api/{sanitize,prompt,role_compat,debug_api}.rs`）：
 *
 *   GET/PUT /api/sanitize                 指纹脱敏：开关 + 词表 + 应用提供商
 *   GET/PUT /api/developer-role-compat    开发者角色兼容：单开关
 *   GET/PUT /api/prompt                   系统提示词：模式 + 文件/正文 + 按提供商覆盖
 *   GET/PUT /api/debug                    调试模式：开关 + 报文存储概况
 *
 * 三个共同点，写代码时别踩：
 *   · PUT 的响应体就是**保存后的新状态** —— 前端直接拿它刷新界面，不用再 GET；
 *   · 全部是「改完下一个请求立即生效」，不重启进程；
 *   · sanitize 的规则数组是 `deny_unknown_fields` 的 camelCase 结构，多一个字段
 *     就 400 —— 所以编辑时按整条规则回传，不做局部补丁。
 */

import { apiCall } from './client'

/* ── 指纹脱敏 ───────────────────────────────────────────────── */

export type SanitizeMatchType = 'literal' | 'regex'

export type SanitizeRule = {
  id: string
  name: string
  enabled?: boolean
  matchType?: SanitizeMatchType
  pattern: string
  replacement?: string
  repeat?: boolean
  /** 空 = 不区分角色；填了只改这些角色里的内容 */
  roles?: string[]
}

export type SanitizeSettings = {
  sanitizeBlacklistFingerprints: boolean
  sanitizeFingerprintRules: SanitizeRule[] | null
  sanitizeFingerprintProviders: string[]
  defaultRules?: SanitizeRule[]
  customRules?: SanitizeRule[] | null
  providerOptions?: Array<{ id: string; label?: string }>
  roleOptions?: string[]
  limits?: {
    maxRules?: number
    maxNameChars?: number
    maxPatternChars?: number
    maxReplacementChars?: number
  }
  /** PUT 独有：落盘是否成功（失败时本次运行内仍生效） */
  saved?: boolean
}

export function fetchSanitize(signal?: AbortSignal): Promise<SanitizeSettings> {
  return apiCall<SanitizeSettings>('/api/sanitize', { signal })
}

/**
 * 部分更新。`rules: null` = 恢复内置词表，`rules: []` = 清空，
 * `sanitizeFingerprintProviders: []` = 应用到全部提供商。
 */
export function saveSanitize(patch: {
  enabled?: boolean
  rules?: SanitizeRule[] | null
  providers?: string[]
}): Promise<SanitizeSettings> {
  const body: Record<string, unknown> = {}
  if (patch.enabled !== undefined) body.sanitizeBlacklistFingerprints = patch.enabled
  if (patch.rules !== undefined) body.sanitizeFingerprintRules = patch.rules
  if (patch.providers !== undefined) body.sanitizeFingerprintProviders = patch.providers
  return apiCall<SanitizeSettings>('/api/sanitize', { method: 'PUT', body })
}

/* ── 开发者角色兼容 ─────────────────────────────────────────── */

export type RoleCompat = { developerRoleCompat: boolean }

export function fetchRoleCompat(signal?: AbortSignal): Promise<RoleCompat> {
  return apiCall<RoleCompat>('/api/developer-role-compat', { signal })
}

export function saveRoleCompat(enabled: boolean): Promise<RoleCompat> {
  return apiCall<RoleCompat>('/api/developer-role-compat', {
    method: 'PUT',
    body: { developerRoleCompat: enabled },
  })
}

/* ── 系统提示词 ─────────────────────────────────────────────── */

export type PromptMode = 'passthrough' | 'custom' | 'append'

export type PromptBlock = {
  promptMode: PromptMode
  promptFile: string
  promptText: string
  /** 生效来源：none / passthrough / builtin / file / inline */
  promptSource?: string
  promptLines?: number
  promptFileError?: string | null
}

export type PromptSettings = PromptBlock & {
  degradeActive?: boolean
  degradeUntil?: number | null
  degradeUntilText?: string | null
  /** 按提供商的覆盖；只含「单独配置过」的提供商 */
  promptProviders?: Record<string, PromptBlock>
  /** 网关自带 system 提示词的逐家开关 */
  promptGateway?: Record<string, boolean>
  promptGatewayText?: Record<string, unknown>
  promptProviderOptions?: Array<{ id: string; label?: string; gatewayBlocks?: unknown }>
}

export function fetchPrompt(signal?: AbortSignal): Promise<PromptSettings> {
  return apiCall<PromptSettings>('/api/prompt', { signal })
}

export function savePrompt(patch: {
  mode?: PromptMode
  file?: string | null
  text?: string | null
  providers?: Record<string, unknown> | null
}): Promise<PromptSettings> {
  const body: Record<string, unknown> = {}
  if (patch.mode !== undefined) body.promptMode = patch.mode
  if (patch.file !== undefined) body.promptFile = patch.file
  if (patch.text !== undefined) body.promptText = patch.text
  if (patch.providers !== undefined) body.promptProviders = patch.providers
  return apiCall<PromptSettings>('/api/prompt', { method: 'PUT', body })
}

/* ── 调试模式 ───────────────────────────────────────────────── */

export type DebugSettings = { debugMode: boolean; count?: number; limit?: number }

export function fetchDebug(signal?: AbortSignal): Promise<DebugSettings> {
  return apiCall<DebugSettings>('/api/debug', { signal })
}

export function saveDebug(enabled: boolean): Promise<DebugSettings> {
  return apiCall<DebugSettings>('/api/debug', { method: 'PUT', body: { debugMode: enabled } })
}

/* ── 展示辅助 ───────────────────────────────────────────────── */

export const PROMPT_MODES: Array<{ value: PromptMode; label: string; hint: string }> = [
  { value: 'passthrough', label: '透传', hint: '客户端自己的 system 原样发上去，网关不插手。' },
  { value: 'custom', label: '替换', hint: '删掉客户端的 system / developer 消息，换成下面这份提示词。' },
  { value: 'append', label: '追加', hint: '保留客户端内容，只在开头 system 之后多插一条。' },
]

/** 生效来源的人话版本（后端给的是 none / builtin / file / inline 这类标识） */
export function promptSourceLabel(source?: string): string {
  switch (source) {
    case 'builtin': return '内置默认'
    case 'file': return '提示词文件'
    case 'inline': return '界面里编辑的正文'
    case 'none':
    case 'passthrough':
    case undefined:
    case '':
      return '未启用'
    default:
      return source
  }
}

/* ── 重试 / 超时 / 排队等待 ─────────────────────────────────── */

export type RetrySettings = {
  retryCount: number
  retryCrossProviderCount: number
  retryIntervalSeconds: number
  noRetryStatusCodes?: string | null
}

export type TimeoutSettings = {
  connectTimeoutSeconds: number
  headersTimeoutSeconds: number
  streamIdleTimeoutSeconds: number
  bodyTimeoutSeconds: number
}

export type QueueSettings = {
  queueMaxWaits: number
  queueWaitSeconds: number
}

export function fetchRetries(signal?: AbortSignal): Promise<RetrySettings> {
  return apiCall<RetrySettings>('/api/retry', { signal })
}

export function saveRetries(patch: Partial<RetrySettings>): Promise<RetrySettings> {
  return apiCall<RetrySettings>('/api/retry', { method: 'PUT', body: patch })
}

export function fetchTimeouts(signal?: AbortSignal): Promise<TimeoutSettings> {
  return apiCall<TimeoutSettings>('/api/timeouts', { signal })
}

export function saveTimeouts(patch: Partial<TimeoutSettings>): Promise<TimeoutSettings> {
  return apiCall<TimeoutSettings>('/api/timeouts', { method: 'PUT', body: patch })
}

export function fetchQueueSettings(signal?: AbortSignal): Promise<QueueSettings> {
  return apiCall<QueueSettings>('/api/queue', { signal })
}

export function saveQueueSettings(patch: Partial<QueueSettings>): Promise<QueueSettings> {
  return apiCall<QueueSettings>('/api/queue', { method: 'PUT', body: patch })
}

/* ── 数据保留 / 存储 / 图片压缩 / models.dev / 版本信息 ────── */

export type RetentionSettings = {
  logRetentionDays: number
  logRetentionCount: number
  requestLogRetentionDays: number
  requestLogRetentionCount: number
  dailyAggregateRetentionDays: number
}

export type StorageOverview = {
  configDir?: string
  database?: {
    file?: string
    bytes?: number
    available?: boolean
    accounts?: number
    logs?: number
    requests?: number
    dailyDays?: number
    debug?: number
    downstreamRaw?: number
    upstreamRaw?: number
  }
}

export type ImageCompressSettings = {
  imageCompressEnabled: boolean
  imageCompressMaxEdge: number
  imageCompressQuality: number
  imageCompressThresholdKb: number
}

export type ModelsDevStatus = {
  modelsDevEnabled?: boolean
  source?: string
  updatedAt?: number
  count?: number
  note?: string
  [key: string]: unknown
}

export type SystemInfo = {
  app?: {
    version?: string
    channel?: string
    schemaVersion?: number
    dbSchemaVersion?: number
    license?: string
    sourceUrl?: string
    copyright?: string
  }
  runtime?: {
    deployment?: string
    container?: boolean | string
    os?: string
    osVersion?: string
    arch?: string
    startedAt?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export function fetchRetention(signal?: AbortSignal): Promise<RetentionSettings> {
  return apiCall<RetentionSettings>('/api/retention', { signal })
}

export function saveRetention(patch: Partial<RetentionSettings>): Promise<RetentionSettings> {
  return apiCall<RetentionSettings>('/api/retention', { method: 'PUT', body: patch })
}

export function fetchStorage(signal?: AbortSignal): Promise<StorageOverview> {
  return apiCall<StorageOverview>('/api/storage', { signal })
}

export function fetchImageCompress(signal?: AbortSignal): Promise<ImageCompressSettings> {
  return apiCall<ImageCompressSettings>('/api/image-compress', { signal })
}

export function saveImageCompress(patch: Partial<ImageCompressSettings>): Promise<ImageCompressSettings> {
  return apiCall<ImageCompressSettings>('/api/image-compress', { method: 'PUT', body: patch })
}

export function fetchModelsDev(signal?: AbortSignal): Promise<ModelsDevStatus> {
  return apiCall<ModelsDevStatus>('/api/models/metadata', { signal })
}

export function saveModelsDev(enabled: boolean): Promise<ModelsDevStatus> {
  return apiCall<ModelsDevStatus>('/api/models/metadata', {
    method: 'PUT',
    body: { modelsDevEnabled: enabled },
  })
}

export function refreshModelsDev(): Promise<unknown> {
  return apiCall('/api/models/metadata/refresh', { method: 'POST' })
}

export function fetchSystemInfo(signal?: AbortSignal): Promise<SystemInfo> {
  return apiCall<SystemInfo>('/api/system-info', { signal })
}

/* ── 面板安全状态 / 更新检查 ───────────────────────────────── */

export type PanelStatus = { registered: boolean }

export function fetchPanelStatus(signal?: AbortSignal): Promise<PanelStatus> {
  return apiCall<PanelStatus>('/api/panel/status', { signal })
}

export type UpdateCheck = {
  current?: string
  latest?: string
  version?: string
  hasUpdate?: boolean
  available?: boolean
  channel?: string
  publishedAt?: number
  notes?: { url?: string; name?: string } | string
  [key: string]: unknown
}

/** `current` 省略时后端按它自己的版本比对，这里显式传当前版本，结果更直观。 */
export function checkUpdate(current: string, signal?: AbortSignal): Promise<UpdateCheck> {
  const query = current ? `?current=${encodeURIComponent(current)}` : ''
  return apiCall<UpdateCheck>(`/api/update/check${query}`, { signal })
}

/** 一条请求的原始报文（调试模式开启时落盘的那份）。 */
export type DebugTraffic = {
  id: string
  ts?: number
  url?: string
  provider?: string
  requestHeaders?: Record<string, string> | string
  requestBody?: string
  status?: number
  responseHeaders?: Record<string, string> | string
  responseBody?: string
  truncated?: boolean
}

export function fetchDebugTraffic(id: string, signal?: AbortSignal): Promise<DebugTraffic> {
  return apiCall<DebugTraffic>(`/api/debug/traffic?id=${encodeURIComponent(id)}`, { signal })
}

/* ── 用量 / 额度 / 活动 / 云同步 ─────────────────────────────── */

/** 网关的额度汇总是上游返回的动态结构，只按已知字段做容错渲染。 */
export type UsageSummary = Record<string, unknown>

export type CheckinStatus = Record<string, unknown> | null

export type CloudSyncView = {
  provider?: string
  enabled?: boolean
  autoSync?: boolean
  remotePath?: string
  remoteRoot?: string
  profile?: string
  status?: {
    lastSyncAt?: number
    lastAction?: string
    lastError?: string
    lastErrorSource?: string
    lastSnapshotId?: string
  }
  keyFingerprint?: string | null
  hasSyncPassword?: boolean
  webdav?: { baseUrl?: string; username?: string; hasPassword?: boolean }
  s3?: { region?: string; bucket?: string; endpoint?: string; hasSecretKey?: boolean }
}

export function fetchUsage(signal?: AbortSignal): Promise<UsageSummary> {
  return apiCall<UsageSummary>('/api/usage', { signal })
}

export function fetchCheckinStatus(signal?: AbortSignal): Promise<CheckinStatus> {
  return apiCall<CheckinStatus>('/api/checkin/status', { signal })
}

export function fetchActivityBanner(signal?: AbortSignal): Promise<unknown> {
  return apiCall('/api/activity/banner', { signal })
}

export function fetchCloudSync(signal?: AbortSignal): Promise<CloudSyncView> {
  return apiCall<CloudSyncView>('/api/cloud-sync', { signal })
}

export function cloudSyncTest(): Promise<unknown> {
  return apiCall('/api/cloud-sync/test', { method: 'POST' })
}

export function cloudSyncUpload(): Promise<unknown> {
  return apiCall('/api/cloud-sync/upload', { method: 'POST' })
}

export function cloudSyncDownload(): Promise<unknown> {
  return apiCall('/api/cloud-sync/download', { method: 'POST' })
}

/* ── 四个出站行为的单开关（GET 读 / PUT 写，响应即新状态） ────── */

export type CorsSetting = { corsEnabled: boolean }
export type KeepaliveStripSetting = { stripNewlineKeepalive: boolean }
export type AutoContinueSetting = { autoContinue: boolean; autoContinueMaxRounds: number }
export type ZcodeVersionSetting = { version: string; envOverride?: string | null }

export function fetchCors(signal?: AbortSignal): Promise<CorsSetting> {
  return apiCall<CorsSetting>('/api/cors', { signal })
}
export function saveCors(enabled: boolean): Promise<CorsSetting> {
  return apiCall<CorsSetting>('/api/cors', { method: 'PUT', body: { corsEnabled: enabled } })
}

export function fetchKeepaliveStrip(signal?: AbortSignal): Promise<KeepaliveStripSetting> {
  return apiCall<KeepaliveStripSetting>('/api/keepalive-strip', { signal })
}
export function saveKeepaliveStrip(enabled: boolean): Promise<KeepaliveStripSetting> {
  return apiCall<KeepaliveStripSetting>('/api/keepalive-strip', {
    method: 'PUT',
    body: { stripNewlineKeepalive: enabled },
  })
}

export function fetchAutoContinue(signal?: AbortSignal): Promise<AutoContinueSetting> {
  return apiCall<AutoContinueSetting>('/api/auto-continue', { signal })
}
export function saveAutoContinue(patch: Partial<AutoContinueSetting>): Promise<AutoContinueSetting> {
  return apiCall<AutoContinueSetting>('/api/auto-continue', { method: 'PUT', body: patch })
}

export function fetchZcodeVersion(signal?: AbortSignal): Promise<ZcodeVersionSetting> {
  return apiCall<ZcodeVersionSetting>('/api/zcode/version', { signal })
}
export function saveZcodeVersion(version: string): Promise<ZcodeVersionSetting> {
  return apiCall<ZcodeVersionSetting>('/api/zcode/version', { method: 'PUT', body: { version } })
}

/* ── 模型别名映射与自定义模型 ───────────────────────────────── */

export type ModelMappingInput = { alias: string; target: string; provider?: string }

/** 新增 / 修改一条别名映射：把对外的 alias 指到真实模型 target。 */
export function addModelMapping(body: ModelMappingInput): Promise<unknown> {
  return apiCall('/api/models/mappings', { method: 'POST', body })
}

export function removeModelMappingByAlias(body: ModelMappingInput): Promise<unknown> {
  return apiCall('/api/models/mappings/remove', { method: 'POST', body })
}

/** 手动登记一个模型目录里没有的模型。 */
export function addCustomModel(body: { provider: string; id: string }): Promise<unknown> {
  return apiCall('/api/models/custom', { method: 'POST', body })
}

export function removeCustomModel(body: { provider: string; id: string }): Promise<unknown> {
  return apiCall('/api/models/custom/remove', { method: 'POST', body })
}
