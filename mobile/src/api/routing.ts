/**
 * 路由（账号选路）API。
 *
 * 契约与桌面端同源（`server/src/server/api/routing_workspace.rs` /
 * `routing_api.rs`），只是桌面端走 Tauri IPC，这里走 HTTP：
 *
 *   GET  /api/routing/workspace?model=   当前生效配置 + 候选账号 + 版本号
 *   PUT  /api/routing/profile            { model, profile|null, revision }
 *   GET  /api/routing/queue?model=       候选队列（谁先、谁被跳过、为什么）
 *
 * 两个容易踩的点：
 *   · `PUT /api/routing/profile` 的 `profile` 是 **deny_unknown_fields** 的
 *     camelCase 结构，字段名多一个少一个都会被 400 —— 所以这里不拼「局部
 *     补丁」，永远回传整份 profile。
 *   · `revision` 是乐观锁。拿旧版本号去写会返回 409（配置已在别的终端改过），
 *     必须重新读一遍再改，不能自动重试 —— 那会把别人的改动盖掉。
 */

import { apiCall } from './client'

export type RouteStrategy = 'order' | 'rotate' | 'provider'
export type RouteSticky = 'auto' | 'session' | 'turn' | 'off'
export type RouteProviderScope = 'all' | 'selected'

/** 提交给后端的整份路由配置。字段名必须与 Rust 侧逐一对应。 */
export type RouteProfile = {
  providerScope?: RouteProviderScope
  providers: string[]
  disabledProviders: string[]
  accountOrder: Record<string, string[]>
  excludedAccounts: string[]
  strategy?: string
  sticky?: string
}

export type RoutingProviderRow = {
  id: string
  label?: string
  accountCount?: number
  custom?: boolean
  available?: boolean
}

export type RoutingSettings = {
  routingStrategy?: string
  routingSticky?: string
  routingFailoverBackoff?: boolean
  routingSink?: boolean
  routingBreakerEnabled?: boolean
  routingBreakerThreshold?: number
  routingBreakerTimeout?: number
  routingBreakerSuccess?: number
}

export type RoutingWorkspace = {
  model: string | null
  customized: boolean
  globalCustomized?: boolean
  configuredModels?: string[]
  models: string[]
  profile: RouteProfile
  inheritedProfile?: RouteProfile
  providers: RoutingProviderRow[]
  accounts: Array<Record<string, unknown>>
  settings: RoutingSettings
  globalSettings?: RoutingSettings
  revision?: string
  accountStates?: Record<string, { model?: string; resetAt?: number; limitedModels?: number }>
  stickyCount?: number
  metrics?: Record<string, unknown>
  updatedAt?: number
}

export type RouteQueueEntry = {
  id: string
  name: string
  provider: string
  providerLabel?: string
  state: string
  reason?: string
  resetAt?: number | null
  priority?: number | null
  // 自定义路由组走 group_queue，条目还会带成员信息
  model?: string | null
  memberId?: string | null
}

export type RouteQueue = {
  strategy: string
  sticky: string
  model: string | null
  modelKnown?: boolean | null
  lastRequestModel?: string | null
  pickedId?: string
  ordered: RouteQueueEntry[]
  blocked: RouteQueueEntry[]
  // 路由组场景
  group?: { id?: string; name?: string } | null
}

function modelQuery(model: string): string {
  return model ? `?model=${encodeURIComponent(model)}` : ''
}

export function fetchRoutingWorkspace(model: string, signal?: AbortSignal): Promise<RoutingWorkspace> {
  return apiCall<RoutingWorkspace>(`/api/routing/workspace${modelQuery(model)}`, { signal })
}

export function fetchRoutingQueue(model: string, signal?: AbortSignal): Promise<RouteQueue> {
  return apiCall<RouteQueue>(`/api/routing/queue${modelQuery(model)}`, { signal })
}

/** 保存整份配置；`profile` 传 null 表示「恢复继承全局」。 */
export function saveRoutingProfile(
  model: string,
  profile: RouteProfile | null,
  revision: string,
): Promise<RoutingWorkspace> {
  return apiCall<RoutingWorkspace>('/api/routing/profile', {
    method: 'PUT',
    body: { model: model || null, profile, revision },
  })
}

/** 把后台给的状态码翻成一句人话。状态串见 routing.rs 的 plan 结果。 */
export function routeStateLabel(state: string): string {
  switch (state) {
    case 'usable': return '可用'
    case 'cooldown': return '冷却中'
    case 'concurrency': return '并发已满'
    case 'disabled': return '已禁用'
    case 'no-credentials': return '无凭证'
    case 'limiter': return '限制器跳过'
    case 'excluded': return '未参与'
    case 'tried': return '已尝试'
    default: return '未就绪'
  }
}

export function routeStateTone(state: string): 'ok' | 'warn' | 'danger' | 'muted' {
  if (state === 'usable') return 'ok'
  if (state === 'cooldown' || state === 'concurrency' || state === 'limiter') return 'warn'
  if (state === 'no-credentials' || state === 'tried') return 'danger'
  return 'muted'
}
