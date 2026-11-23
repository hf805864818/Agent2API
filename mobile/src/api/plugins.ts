import { apiCall } from './client'
import { githubErrorMessage } from '../../../ui-shared/updates'
import { t } from '../i18n'
import type {
  PluginMutation, PluginOperation, PluginSettings, PluginsPayload, PluginUpdate, ReleaseState,
} from '../../../ui-shared/plugins'

export type {
  PackProvider, PackSummary, PluginMutation, PluginOperation, PluginSettings,
  PluginsPayload, PluginUpdate, StorePlugin,
} from '../../../ui-shared/plugins'

/** 网关若在 `/api/plugins` 里带上插件源，就在这里；缺失时由 resolvePluginSource 兜底。 */
export type PluginsPayloadWithSource = PluginsPayload & { source?: Partial<PluginSource> | null }

export function pluginErrorMessage(error: unknown): string {
  return githubErrorMessage(error, t, 'plugin')
}

export function getPlugins(signal?: AbortSignal): Promise<PluginsPayloadWithSource> {
  return apiCall('/api/plugins', { signal })
}

export function refreshPluginCatalog(): Promise<ReleaseState> {
  return apiCall('/api/plugins/release')
}

export function checkPluginUpdates(): Promise<{ error?: boolean; reason?: string; updates?: PluginUpdate[] }> {
  return apiCall('/api/plugins/update')
}

export function startPluginInstall(id: string, target: string, update = false): Promise<{ operation: PluginOperation }> {
  return apiCall(update ? '/api/plugins/update' : '/api/plugins/install-from-release', {
    method: 'POST',
    body: { id, target },
  })
}

export function setPluginEnabled(id: string, enabled: boolean): Promise<PluginMutation> {
  return apiCall('/api/plugins/enable', { method: 'POST', body: { id, enabled } })
}

export function setPluginProvider(id: string, provider: string, enabled: boolean): Promise<PluginMutation> {
  return apiCall('/api/plugins/provider', { method: 'POST', body: { id, provider, enabled } })
}

export function uninstallPlugin(id: string): Promise<PluginMutation> {
  return apiCall('/api/plugins/uninstall', { method: 'POST', body: { id } })
}

export function getPluginSettings(signal?: AbortSignal): Promise<PluginSettings> {
  return apiCall('/api/plugins/settings', { signal })
}

export function savePluginSettings(body: Partial<PluginSettings>): Promise<PluginSettings> {
  return apiCall('/api/plugins/settings', { method: 'PATCH', body })
}

/**
 * 插件更新源。
 *
 * 值与网关 `server/core/plugin_host/update.rs` 的 `INDEX_REPO` / `FALLBACK_REPO`
 * 保持一致。网关目前不把这两个常量放进 `/api/plugins` 的响应里，所以这里留一份
 * 兜底值：`payload.source` 存在时以服务端为准，不存在时用这份，避免手机端出现
 * 「更新源未知」。网关升级换仓库后，旧 APK 会显示旧地址 —— 这是可接受的降级，
 * 好过整块不显示。
 */
export const PLUGIN_INDEX_REPO = 'Agent2plugin/Agent2plugin'
export const PLUGIN_FALLBACK_REPO = 'Agent2Builder/agent2api-providers-releases'

export type PluginSource = {
  indexRepo: string
  fallbackRepo: string
  /** 索引文件（index.json）的完整地址 */
  indexUrl: string
  /** 仓库网页地址 */
  pageUrl: string
}

/** 由仓库名推导出索引与网页地址；服务端给了 `source` 就用服务端的。 */
export function resolvePluginSource(payload: { source?: Partial<PluginSource> | null } | null): PluginSource {
  const repo = (payload?.source?.indexRepo || PLUGIN_INDEX_REPO).trim() || PLUGIN_INDEX_REPO
  const fallback = (payload?.source?.fallbackRepo || PLUGIN_FALLBACK_REPO).trim() || PLUGIN_FALLBACK_REPO
  return {
    indexRepo: repo,
    fallbackRepo: fallback,
    indexUrl: payload?.source?.indexUrl || `https://raw.githubusercontent.com/${repo}/main/index.json`,
    pageUrl: payload?.source?.pageUrl || `https://github.com/${repo}`,
  }
}
