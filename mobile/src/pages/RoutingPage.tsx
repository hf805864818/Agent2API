import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageIntro, IconButton, Empty, ErrorNote, SkeletonList, Badge, SectionHead } from '../components/ui'
import { ProviderLogo } from '../components/ProviderLogo'
import { Icon } from '../components/Icon'
import { PullIndicator, usePullToRefresh } from '../components/PullToRefresh'
import { store } from '../state/store'
import {
  fetchRoutingQueue,
  fetchRoutingWorkspace,
  saveRoutingProfile,
  routeStateLabel,
  routeStateTone,
  type RouteProfile,
  type RouteQueue,
  type RouteQueueEntry,
  type RouteSticky,
  type RouteStrategy,
  type RoutingWorkspace,
} from '../api/routing'
import { accountName, formatRelative } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { usePolling } from '../lib/usePolling'
import { t } from '../i18n'
import {
  Button,
  Card,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch as UiSwitch,
} from '@ui'

/**
 * 路由（账号选路）。
 *
 * 桌面端这一页是一块可视化的流程图 —— 左列配置、中间画布、右列账号组，
 * 三栏同屏靠的是 1440px 宽。手机上没有这个余量，所以按「先改配置、再看
 * 结果」拆成两个页签：
 *
 *   · 配置：策略、会话粘滞、哪些提供商参与、每个提供商内部的账号顺序；
 *   · 队列：按当前规则算出来的候选顺序，以及**谁被跳过、为什么**
 *     （禁用 / 冷却 / 并发满 / 限流器 / 无凭证各有一档）。
 *
 * 队列那半是这一页真正有价值的部分：桌面端和手机端调的是同一个
 * `plan_route`，所以手机上看到的顺序就是下一个请求会走的顺序，不是
 * 「大概这样」的模拟。
 *
 * 两处刻意的收敛：
 *   · 账号顺序用「上移 / 下移」按钮而不是拖拽 —— 窄屏拖拽命中率低，
 *     而且拖到边界时看不出来是「没放下」还是「不让动」；
 *   · 不提供配置组的增删（那是桌面端的成组路由），只在组内改会 400，
 *     后端也会拦住。
 */

type Tab = 'config' | 'queue'

const STRATEGIES: Array<{ value: RouteStrategy; label: string; hint: string }> = [
  { value: 'order', label: t('顺序优先'), hint: t('优先使用队首账号，不可用时顺延。') },
  { value: 'rotate', label: t('负载均衡'), hint: t('可用账号按请求轮换；开启会话粘性时同一会话优先留在原账号。') },
  { value: 'provider', label: t('家内轮询'), hint: t('提供商保持优先顺序，同一提供商的账号轮流承接。') },
]

const STICKIES: Array<{ value: RouteSticky; label: string; hint: string }> = [
  { value: 'auto', label: t('自动'), hint: t('五分钟没有往来即释放；客户端会话标识优先，内容哈希兜底。') },
  { value: 'session', label: t('会话内'), hint: t('会话最长保持六小时无往来；可以随时在会话粘滞中解除。') },
  { value: 'turn', label: t('每轮'), hint: t('每轮重新选路，不保留跨请求的账号绑定。') },
  { value: 'off', label: t('关闭'), hint: t('完全不保留粘滞，每次请求都重新排。') },
]

export function RoutingPage() {
  const [tab, setTab] = useState<Tab>('config')
  const [scope, setScope] = useState('')
  const [workspace, setWorkspace] = useState<RoutingWorkspace | null>(null)
  const [queue, setQueue] = useState<RouteQueue | null>(null)
  const [draft, setDraft] = useState<RouteProfile | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const seq = useRef(0)

  /** 把后端返回的配置抄成草稿；只在读盘时调用，不覆盖未保存改动。 */
  const adopt = useCallback((next: RoutingWorkspace) => {
    setWorkspace(next)
    setDraft({
      providerScope: next.profile.providerScope,
      providers: [...(next.profile.providers || [])],
      disabledProviders: [...(next.profile.disabledProviders || [])],
      accountOrder: Object.fromEntries(
        Object.entries(next.profile.accountOrder || {}).map(([key, ids]) => [key, [...ids]]),
      ),
      excludedAccounts: [...(next.profile.excludedAccounts || [])],
      strategy: next.profile.strategy,
      sticky: next.profile.sticky,
    })
  }, [])

  const load = useCallback(async (silent = false) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const next = await fetchRoutingWorkspace(scope)
      if (id !== seq.current) return
      if (!next?.profile || !Array.isArray(next.accounts)) throw new Error(t('路由接口返回了不完整的数据'))
      adopt(next)
      setError('')
    } catch (failure) {
      if (id === seq.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [scope, adopt])

  const loadQueue = useCallback(async () => {
    const id = seq.current
    try {
      const next = await fetchRoutingQueue(scope)
      if (id !== seq.current) return
      setQueue(next)
    } catch {
      /* 队列只是观测视图：拉失败不打断配置编辑，页面上留旧值 */
    }
  }, [scope])

  useEffect(() => {
    setQueue(null)
    void load()
    return () => { seq.current++ }
  }, [load])

  // 队列每 15 秒重算一次：它反映的是冷却 / 并发这些会自己变的实时状态。
  usePolling(() => { if (tab === 'queue') void loadQueue() }, 15_000)
  useEffect(() => { if (tab === 'queue') void loadQueue() }, [tab, loadQueue])

  const pull = usePullToRefresh({ onRefresh: () => (tab === 'queue' ? loadQueue() : load(true)) })

  const dirty = useMemo(() => {
    if (!workspace || !draft) return false
    return JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(workspace.profile))
  }, [draft, workspace])

  const accountsById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>()
    for (const account of workspace?.accounts || []) {
      const id = typeof account.id === 'string' ? account.id : ''
      if (id) map.set(id, account)
    }
    return map
  }, [workspace])

  const providerRows = workspace?.providers || []
  const orderedProviders = draft ? draft.providers : []

  const setStrategy = (value: string) => updateDraft(current => ({ ...current, strategy: value }))
  const setSticky = (value: string) => updateDraft(current => ({ ...current, sticky: value }))

  function updateDraft(mutate: (current: RouteProfile) => RouteProfile) {
    setDraft(current => (current ? mutate(current) : current))
  }

  const toggleProvider = (id: string, included: boolean) => {
    updateDraft(current => {
      const disabled = new Set(current.disabledProviders)
      const providers = [...current.providers]
      if (included) {
        disabled.delete(id)
        if (!providers.includes(id)) providers.push(id)
      } else {
        disabled.add(id)
      }
      return { ...current, providers, disabledProviders: [...disabled] }
    })
  }

  const toggleAccount = (provider: string, accountId: string, included: boolean) => {
    updateDraft(current => {
      const excluded = new Set(current.excludedAccounts)
      if (included) excluded.delete(accountId)
      else excluded.add(accountId)
      return { ...current, excludedAccounts: [...excluded] }
    })
  }

  /** 账号在该提供商内的先后顺序；没有显式配置时按账号列表原始顺序兜底。 */
  const orderOf = (provider: string): string[] => {
    const configured = draft?.accountOrder?.[provider]
    if (configured?.length) return configured
    return (workspace?.accounts || [])
      .filter(account => account.provider === provider)
      .map(account => String(account.id || ''))
      .filter(Boolean)
  }

  const moveAccount = (provider: string, id: string, delta: -1 | 1) => {
    updateDraft(current => {
      const list = [...(current.accountOrder?.[provider]?.length
        ? current.accountOrder[provider]
        : orderOf(provider))]
      const index = list.indexOf(id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= list.length) return current
      ;[list[index], list[target]] = [list[target], list[index]]
      return { ...current, accountOrder: { ...current.accountOrder, [provider]: list } }
    })
  }

  const save = async () => {
    if (!draft || !workspace?.revision) return
    setSaving(true)
    try {
      const next = await saveRoutingProfile(scope, payloadOf(draft), workspace.revision)
      adopt(next)
      store.toast(t('已保存路由配置'))
      void loadQueue()
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
      // 409 多半是版本过期：重读一次把最新版本号拿回来，让用户看到真实配置
      void load(true)
    } finally {
      setSaving(false)
    }
  }

  const restoreInherit = async () => {
    if (!workspace?.revision || !scope) return
    setSaving(true)
    try {
      const next = await saveRoutingProfile(scope, null, workspace.revision)
      adopt(next)
      store.toast(t('已恢复为继承全局'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
      void load(true)
    } finally {
      setSaving(false)
    }
  }

  const scopeLabel = scope ? scope : t('全局默认')
  const models = workspace?.models || []

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageIntro
        subtitle={t('账号选路与候选顺序')}
        actions={<IconButton name='refresh' label={t('刷新')} onClick={() => (tab === 'queue' ? void loadQueue() : void load(true))} />}
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        <SegmentedControl
          options={[{ value: 'config', label: t('路由配置') }, { value: 'queue', label: t('候选队列') }]}
          value={tab}
          aria-label={t('路由页签')}
          onValueChange={value => setTab(value as Tab)}
        />
      </div>

      <div className='m-section' style={{ marginTop: 8 }}>
        <Button
          size='default'
          variant='outline'
          type='button'
          className='m-row h-auto min-h-[52px] w-full justify-start rounded-[14px] px-3.5 py-3 text-left'
          onClick={() => setPickerOpen(true)}
        >
          <span className='m-logo'>
            <Icon name='filter' />
          </span>
          <div className='m-grow'>
            <div className='m-t1'>{t('作用范围')}</div>
            <div className='m-t2 m-mono' style={{ fontSize: 11.5 }}>{scopeLabel}</div>
          </div>
          <span className='m-chev'><Icon name='chev' /></span>
        </Button>
        {workspace?.customized ? (
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--m-primary)', padding: '0 2px' }}>
            {t('该范围有独立配置，不再跟随全局')}
          </div>
        ) : null}
      </div>

      {error ? <ErrorNote text={error} /> : null}
      {loading && !workspace ? <SkeletonList rows={4} height={70} /> : null}

      {tab === 'config' && draft && workspace ? (
        <>
          <div className='m-section'>
            <SectionHead title={t('路由策略')} />
            <Card className='m-card m-card-pad'>
              <SegmentedControl
                options={STRATEGIES.map(item => ({ value: item.value, label: item.label }))}
                value={currentStrategy(draft, workspace)}
                aria-label={t('路由策略')}
                onValueChange={setStrategy}
              />
              <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.65 }}>
                {STRATEGIES.find(item => item.value === currentStrategy(draft, workspace))?.hint}
              </div>
            </Card>
          </div>

          <div className='m-section'>
            <SectionHead title={t('会话粘滞')} />
            <Card className='m-card m-card-pad'>
              <SegmentedControl
                options={STICKIES.map(item => ({ value: item.value, label: item.label }))}
                value={currentSticky(draft, workspace)}
                aria-label={t('会话粘滞')}
                onValueChange={setSticky}
              />
              <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.65 }}>
                {STICKIES.find(item => item.value === currentSticky(draft, workspace))?.hint}
              </div>
            </Card>
          </div>

          <div className='m-section'>
            <SectionHead title={t('参与路由的提供商')} />
            <Card className='m-card'>
              {orderedProviders.length ? orderedProviders.map(id => {
                const row = providerRows.find(item => item.id === id)
                const included = !draft.disabledProviders.includes(id)
                const accounts = orderOf(id)
                const open = expanded.has(id)
                return (
                  <div key={id} style={{ borderBottom: '1px solid var(--m-line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px' }}>
                      <ProviderLogo id={id} label={row?.label} />
                      <Button
                        size='default'
                        variant='ghost'
                        type='button'
                        className='h-auto justify-start border-0 bg-transparent p-0 text-left'
                        // `.m-grow` 只在 `.m-row` 里生效（见 ui-kit/styles/mobile.css），
                        // 这一行是自己拼的 flex 容器，所以显式写 flex:1，否则开关
                        // 会紧贴文字而不是靠右。
                        style={{ flex: 1, minWidth: 0 }}
                        disabled={!accounts.length}
                        onClick={() => setExpanded(current => toggleSet(current, id))}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className='m-t1'>{providerLabel(id, row?.label)}</div>
                          <div className='m-t2'>
                            {t('{n} 个账号', { n: accounts.length })}
                            {row?.available === false ? ` · ${t('模型绑定不可用')}` : ''}
                          </div>
                        </div>
                      </Button>
                      <UiSwitch
                        size='touch'
                        variant='success'
                        checked={included}
                        aria-label={providerLabel(id, row?.label)}
                        onCheckedChange={next => toggleProvider(id, next)}
                      />
                    </div>
                    {open && included ? (
                      <div style={{ padding: '0 14px 10px' }}>
                        {accounts.map((accountId, index) => {
                          const account = accountsById.get(accountId) || {}
                          const participates = !draft.excludedAccounts.includes(accountId)
                          return (
                            <div
                              key={accountId}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '7px 0',
                                borderTop: index ? '1px dashed var(--m-line)' : 'none',
                              }}
                            >
                              <span
                                className='m-mono'
                                style={{ width: 22, fontSize: 11, color: 'var(--m-text-3)', textAlign: 'center' }}
                              >
                                {index + 1}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className='m-t1' style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {accountName(account as { displayName?: string; name?: string; nickname?: string; email?: string; id?: string })}
                                </div>
                                {account.enabled === false ? (
                                  <div style={{ fontSize: 10.5, color: 'var(--m-danger)', marginTop: 2 }}>{t('账号已禁用')}</div>
                                ) : null}
                              </div>
                              <IconButton name='up' label={t('上移')} onClick={() => moveAccount(id, accountId, -1)} />
                              <IconButton name='down' label={t('下移')} onClick={() => moveAccount(id, accountId, 1)} />
                              <UiSwitch
                                size='touch'
                                variant='success'
                                checked={participates}
                                aria-label={t('参与路由')}
                                onCheckedChange={next => toggleAccount(id, accountId, next)}
                              />
                            </div>
                          )
                        })}
                        <div style={{ fontSize: 10.5, color: 'var(--m-text-3)', marginTop: 4, lineHeight: 1.6 }}>
                          {t('顺序决定同一提供商内的挑选先后；关掉开关等于把该账号排除在路由之外。')}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              }) : <Empty text={t('还没有可参与路由的提供商')} />}
            </Card>
          </div>

          <div className='m-section'>
            <div className='m-btn-row'>
              {scope ? (
                <Button size='touch' variant='outline' className='m-btn m-ghost' style={{ flex: 1 }} disabled={saving} onClick={() => void restoreInherit()}>
                  {t('恢复继承')}
                </Button>
              ) : null}
              <Button size='touch' variant='default' className='m-btn' style={{ flex: 1 }} disabled={saving || !dirty} onClick={() => void save()}>
                {saving ? t('正在保存…') : dirty ? t('保存路由') : t('已保存')}
              </Button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6, padding: '0 2px' }}>
              {t('账号启用状态在「账号」页改，这里只改路由；保存后下一个请求立即生效，不用重启。')}
            </div>
          </div>
        </>
      ) : null}

      {tab === 'queue' ? (
        <QueueView queue={queue} scope={scope} />
      ) : null}

      {pickerOpen ? (
        <Sheet open onOpenChange={open => { if (!open) setPickerOpen(false) }}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t('作用范围')}</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <div style={{ fontSize: 12, color: 'var(--m-text-3)', lineHeight: 1.7, marginBottom: 10 }}>
                {t('全局默认对所有模型生效；选某个模型可以只给它单独一套规则。')}
              </div>
              <Card className='m-card'>
                <ScopeRow
                  label={t('全局默认')}
                  sub={t('所有模型')}
                  active={!scope}
                  onClick={() => { setScope(''); setPickerOpen(false) }}
                />
                {models.map(model => (
                  <ScopeRow
                    key={model}
                    label={model}
                    mono
                    active={scope === model}
                    onClick={() => { setScope(model); setPickerOpen(false) }}
                  />
                ))}
              </Card>
              {!models.length ? <Empty text={t('网关还没报告任何模型')} /> : null}
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}

function ScopeRow({ label, sub, active, mono, onClick }: {
  label: string
  sub?: string
  active: boolean
  mono?: boolean
  onClick: () => void
}) {
  return (
    <Button
      size='default'
      variant='ghost'
      type='button'
      className='m-row h-auto min-h-[48px] w-full justify-start rounded-none border-0 px-3.5 py-2.5 text-left last:border-0'
      onClick={onClick}
    >
      <div className='m-grow' style={{ minWidth: 0 }}>
        <div className={mono ? 'm-t1 m-mono' : 'm-t1'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        {sub ? <div className='m-t2'>{sub}</div> : null}
      </div>
      {active ? <Icon name='check' style={{ width: 16, height: 16, color: 'var(--m-primary)' }} /> : null}
    </Button>
  )
}

function QueueView({ queue, scope }: { queue: RouteQueue | null; scope: string }) {
  if (!queue) return <SkeletonList rows={3} height={64} />
  const ordered = queue.ordered || []
  const blocked = queue.blocked || []
  const picked = ordered[0]
  return (
    <>
      <div className='m-section' style={{ marginTop: 0 }}>
        <Card className='m-card m-card-pad'>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--m-text-3)' }}>
            <Badge tone='brand'>{strategyLabel(queue.strategy)}</Badge>
            <Badge tone='mute'>{t('粘滞：{v}', { v: stickyLabel(queue.sticky) })}</Badge>
            <Badge tone='mute'>{scope || t('全局默认')}</Badge>
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--m-text-2)', lineHeight: 1.6 }}>
            {picked ? (
              <>
                {t('下一个请求将走')}
                <span style={{ color: 'var(--m-primary)', fontWeight: 600 }}> {picked.name || picked.id}</span>
                <span className='m-mono' style={{ color: 'var(--m-text-3)' }}> · {providerLabel(picked.provider, picked.providerLabel)}</span>
              </>
            ) : (
              t('当前没有可用账号，请求会被拒绝')
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--m-text-3)' }}>
            {t('可用 {ok} 个 · 跳过 {bad} 个', { ok: ordered.length, bad: blocked.length })}
            {queue.lastRequestModel ? ` · ${t('最近请求模型：')}${queue.lastRequestModel}` : ''}
          </div>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('候选顺序')} />
        <Card className='m-card'>
          {ordered.length ? ordered.map((entry, index) => (
            <QueueRow key={`${entry.id}-${index}`} entry={entry} index={index + 1} />
          )) : <Empty text={t('没有可用候选')} />}
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('被跳过')} />
        <Card className='m-card'>
          {blocked.length ? blocked.map((entry, index) => (
            <QueueRow key={`${entry.id}-b-${index}`} entry={entry} />
          )) : <Empty text={t('没有被跳过的账号')} />}
        </Card>
      </div>
    </>
  )
}

function QueueRow({ entry, index }: { entry: RouteQueueEntry; index?: number }) {
  const tone = routeStateTone(entry.state)
  const badgeTone = tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'danger' ? 'bad' : 'mute'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--m-line)' }}>
      {index ? (
        <span className='m-mono' style={{ width: 20, fontSize: 11.5, color: 'var(--m-text-3)', textAlign: 'center' }}>
          {index}
        </span>
      ) : (
        <span style={{ width: 20 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className='m-t1' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name || entry.id}
        </div>
        <div className='m-t2' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {providerLabel(entry.provider, entry.providerLabel)}
          {entry.reason ? ` · ${entry.reason}` : ''}
        </div>
      </div>
      {entry.resetAt ? (
        <span style={{ fontSize: 10.5, color: 'var(--m-text-3)', whiteSpace: 'nowrap' }}>
          {formatRelative(entry.resetAt)}
        </span>
      ) : null}
      <Badge tone={badgeTone}>{routeStateLabel(entry.state)}</Badge>
    </div>
  )
}

function strategyLabel(value: string): string {
  return STRATEGIES.find(item => item.value === value)?.label || value || '—'
}

function stickyLabel(value: string): string {
  return STICKIES.find(item => item.value === value)?.label || value || '—'
}

/**
 * 草稿里的 strategy/sticky 可能为空 —— 表示「沿用全局」。展示时要落回
 * 生效值，否则分段控件没有任何一项高亮，看着像坏了。
 */
function currentStrategy(draft: RouteProfile, workspace: RoutingWorkspace): string {
  return draft.strategy || workspace.settings?.routingStrategy || 'order'
}

function currentSticky(draft: RouteProfile, workspace: RoutingWorkspace): string {
  return draft.sticky || workspace.settings?.routingSticky || 'auto'
}

/** 提交前把生效值写死，避免「以为改了其实还是继承」。 */
function payloadOf(draft: RouteProfile): RouteProfile {
  return {
    providerScope: draft.providerScope,
    providers: draft.providers,
    disabledProviders: draft.disabledProviders,
    accountOrder: draft.accountOrder,
    excludedAccounts: draft.excludedAccounts,
    strategy: draft.strategy,
    sticky: draft.sticky,
  }
}

/** 比较「有没有改动」时忽略字段顺序与缺省 undefined。 */
function normalize(profile: RouteProfile): unknown {
  return {
    providerScope: profile.providerScope ?? null,
    providers: [...(profile.providers || [])],
    disabledProviders: [...(profile.disabledProviders || [])].sort(),
    accountOrder: Object.fromEntries(
      Object.entries(profile.accountOrder || {}).sort(([a], [b]) => a.localeCompare(b)),
    ),
    excludedAccounts: [...(profile.excludedAccounts || [])].sort(),
    strategy: profile.strategy ?? null,
    sticky: profile.sticky ?? null,
  }
}

function toggleSet(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
