import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageIntro, IconButton, Empty, ErrorNote, SkeletonList, Badge, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { ProviderLogo } from '../components/ProviderLogo'
import { PullIndicator, usePullToRefresh } from '../components/PullToRefresh'
import { store } from '../state/store'
import {
  PROMPT_MODES,
  fetchDebug,
  fetchPrompt,
  fetchRoleCompat,
  fetchSanitize,
  promptSourceLabel,
  saveDebug,
  savePrompt,
  saveRoleCompat,
  saveSanitize,
  fetchAutoContinue,
  fetchCors,
  fetchKeepaliveStrip,
  fetchZcodeVersion,
  saveAutoContinue,
  saveCors,
  saveKeepaliveStrip,
  saveZcodeVersion,
  fetchQueueSettings,
  fetchRetries,
  fetchTimeouts,
  saveQueueSettings,
  saveRetries,
  saveTimeouts,
  type PromptBlock,
  type PromptMode,
  type PromptSettings,
  type AutoContinueSetting,
  type QueueSettings,
  type RetrySettings,
  type TimeoutSettings,
  type SanitizeMatchType,
  type SanitizeRule,
  type SanitizeSettings,
  type DebugSettings,
} from '../api/gateway-settings'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'
import {
  Button,
  Card,
  Input,
  Label,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch as UiSwitch,
  Textarea,
} from '@ui'

/**
 * 网关设置（设置 → 网关 的安卓版）。
 *
 * 四组「出站内容处理」开关，桌面端在同一个左侧导航里依次排开；手机上按卡片
 * 纵向排，每张卡自己一个「保存」—— 四组是四个独立端点，合并成一键保存只会
 * 让「到底哪一组没存上」变难查。
 *
 * 顺序按「影响面从大到小」：指纹脱敏（改写请求体与头）→ 开发者角色兼容
 * （改写消息角色）→ 系统提示词（改写 system）→ 调试模式（只落盘，不改流量）。
 *
 * 三处刻意的取舍：
 *   · 脱敏词表用清单 + 抽屉编辑，不做整段 JSON 文本框 —— 规则是结构化字段，
 *     手写 JSON 在手机上必然引号打错；
 *   · 提示词正文单独一个全屏抽屉（600 行级别的文本，页面里塞一行预览就够）；
 *   · 按提供商覆盖只给「已单独配置过」的那几家，清空即恢复跟随全局 —— 与
 *     桌面端 `promptProviders` 的语义一致，不做新建空覆盖。
 */

type SanitizeDraft = {
  enabled: boolean
  providers: string[]
  rules: SanitizeRule[]
}

export function GatewaySettingsPage() {
  const [sanitize, setSanitize] = useState<SanitizeSettings | null>(null)
  const [sanitizeDraft, setSanitizeDraft] = useState<SanitizeDraft | null>(null)
  const [role, setRole] = useState<boolean | null>(null)
  const [prompt, setPrompt] = useState<PromptSettings | null>(null)
  const [promptDraft, setPromptDraft] = useState<{ mode: PromptMode; text: string } | null>(null)
  const [debug, setDebug] = useState<DebugSettings | null>(null)
  const [retryDraft, setRetryDraft] = useState<Record<string, string> | null>(null)
  const [timeoutDraft, setTimeoutDraft] = useState<Record<string, string> | null>(null)
  const [queueDraft, setQueueDraft] = useState<Record<string, string> | null>(null)
  const [cors, setCors] = useState<boolean | null>(null)
  const [stripKeepalive, setStripKeepalive] = useState<boolean | null>(null)
  const [autoContinue, setAutoContinue] = useState<AutoContinueSetting | null>(null)
  const [zcode, setZcode] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [ruleSheet, setRuleSheet] = useState<SanitizeRule | 'new' | null>(null)
  const [textSheet, setTextSheet] = useState(false)
  // 按提供商覆盖：新增/编辑抽屉
  const [provSheet, setProvSheet] = useState(false)
  const [provTarget, setProvTarget] = useState('')
  const [provMode, setProvMode] = useState<PromptMode>('custom')
  const [provText, setProvText] = useState('')
  const [textDraft, setTextDraft] = useState('')
  const seq = useRef(0)
  // 三组数值设置的「上次保存值」。用 ref 而不是 state：只参与 dirty 判定，
  // 不驱动渲染，放 state 里会多一次无意义的重绘。
  const retryBase = useRef('')
  const timeoutBase = useRef('')
  const queueBase = useRef('')

  const adoptSanitize = useCallback((next: SanitizeSettings) => {
    setSanitize(next)
    setSanitizeDraft({
      enabled: Boolean(next.sanitizeBlacklistFingerprints),
      providers: [...(next.sanitizeFingerprintProviders || [])],
      rules: (next.sanitizeFingerprintRules || next.defaultRules || []).map(rule => ({ ...rule })),
    })
  }, [])

  const adoptPrompt = useCallback((next: PromptSettings) => {
    setPrompt(next)
    setPromptDraft({ mode: next.promptMode, text: next.promptText || '' })
  }, [])

  const load = useCallback(async (silent = false) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const [sanitizeNext, roleNext, promptNext, debugNext, retryNext, timeoutNext, queueNext, corsNext, stripNext, autoNext, zcodeNext] = await Promise.all([
        fetchSanitize(),
        fetchRoleCompat(),
        fetchPrompt(),
        fetchDebug(),
        fetchRetries(),
        fetchTimeouts(),
        fetchQueueSettings(),
        fetchCors(),
        fetchKeepaliveStrip(),
        fetchAutoContinue(),
        fetchZcodeVersion(),
      ])
      if (id !== seq.current) return
      if (!sanitizeNext || !promptNext) throw new Error(t('网关设置接口返回了不完整的数据'))
      adoptSanitize(sanitizeNext)
      adoptPrompt(promptNext)
      setRole(Boolean(roleNext?.developerRoleCompat))
      setDebug(debugNext)
      setRetryDraft(toNumberDraft(retryNext as unknown as Record<string, unknown>, RETRY_FIELDS))
      setTimeoutDraft(toNumberDraft(timeoutNext as unknown as Record<string, unknown>, TIMEOUT_FIELDS))
      setQueueDraft(toNumberDraft(queueNext as unknown as Record<string, unknown>, QUEUE_FIELDS))
      setCors(Boolean(corsNext?.corsEnabled))
      setStripKeepalive(Boolean(stripNext?.stripNewlineKeepalive))
      setAutoContinue(autoNext && typeof autoNext === 'object' ? autoNext : null)
      setZcode(String(zcodeNext?.version ?? ''))
      retryBase.current = JSON.stringify(toNumberDraft(retryNext as unknown as Record<string, unknown>, RETRY_FIELDS))
      timeoutBase.current = JSON.stringify(toNumberDraft(timeoutNext as unknown as Record<string, unknown>, TIMEOUT_FIELDS))
      queueBase.current = JSON.stringify(toNumberDraft(queueNext as unknown as Record<string, unknown>, QUEUE_FIELDS))
      setError('')
    } catch (failure) {
      if (id === seq.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [adoptSanitize, adoptPrompt])

  useEffect(() => {
    void load()
    return () => { seq.current++ }
  }, [load])

  const pull = usePullToRefresh({ onRefresh: () => load(true) })

  const sanitizeDirty = useMemo(() => {
    if (!sanitize || !sanitizeDraft) return false
    return JSON.stringify(normalizeSanitize(sanitizeDraft)) !== JSON.stringify(normalizeSanitize({
      enabled: Boolean(sanitize.sanitizeBlacklistFingerprints),
      providers: sanitize.sanitizeFingerprintProviders || [],
      rules: (sanitize.sanitizeFingerprintRules || sanitize.defaultRules || []).map(rule => ({ ...rule })),
    }))
  }, [sanitize, sanitizeDraft])

  const promptDirty = useMemo(() => {
    if (!prompt || !promptDraft) return false
    return promptDraft.mode !== prompt.promptMode || promptDraft.text !== (prompt.promptText || '')
  }, [prompt, promptDraft])

  const retryDirty = retryDraft ? JSON.stringify(retryDraft) !== retryBase.current : false
  const timeoutDirty = timeoutDraft ? JSON.stringify(timeoutDraft) !== timeoutBase.current : false
  const queueDirty = queueDraft ? JSON.stringify(queueDraft) !== queueBase.current : false

  /**
   * 数值类设置的保存。后端对越界值会回 400 并带上合法范围，所以这里只做
   * 「是不是整数」的前置校验，范围交给网关判定 —— 前端各写一份区间，改了
   * 后端忘了改前端就会两头不一致。
   */
  const applyNumbers = async (
    kind: 'retry' | 'timeout' | 'queue',
    draft: Record<string, string>,
    fields: Array<{ key: string }>,
    saver: (patch: Record<string, number>) => Promise<unknown>,
    setter: (next: Record<string, string>) => void,
  ) => {
    const payload: Record<string, number> = {}
    for (const field of fields) {
      const raw = (draft[field.key] ?? '').trim()
      const value = Number(raw)
      if (!raw || !Number.isInteger(value) || value < 0) {
        store.toast(t('{name} 必须是非负整数', { name: field.key }), 'err')
        return
      }
      payload[field.key] = value
    }
    setBusy(kind)
    try {
      const next = await saver(payload)
      const adopted = toNumberDraft(next as unknown as Record<string, unknown>, fields)
      setter(adopted)
      if (kind === 'retry') retryBase.current = JSON.stringify(adopted)
      if (kind === 'timeout') timeoutBase.current = JSON.stringify(adopted)
      if (kind === 'queue') queueBase.current = JSON.stringify(adopted)
      store.toast(t('已保存'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  /** 单开关的通用保存：先乐观更新，失败回滚。 */
  const flip = async (
    key: string,
    next: boolean,
    setter: (value: boolean) => void,
    saver: (value: boolean) => Promise<unknown>,
    okText: string,
  ) => {
    setter(next)
    setBusy(key)
    try {
      await saver(next)
      store.toast(okText)
    } catch (failure) {
      setter(!next)
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const patchSanitize = (mutate: (current: SanitizeDraft) => SanitizeDraft) => {
    setSanitizeDraft(current => (current ? mutate(current) : current))
  }

  const applySanitize = async () => {
    if (!sanitizeDraft) return
    setBusy('sanitize')
    try {
      const next = await saveSanitize({
        enabled: sanitizeDraft.enabled,
        // 词表内容与内置一致时回 null（= 跟随内置），否则回整份自定义词表：
        // 后端对 null 与数组的处理不同，回多一份「看起来一样」的数组会让
        // 以后内置词表更新时这台上不了车。
        rules: sameRules(sanitizeDraft.rules, sanitize?.defaultRules || [])
          ? null
          : sanitizeDraft.rules,
        providers: sanitizeDraft.providers,
      })
      adoptSanitize(next)
      store.toast(t('已保存指纹脱敏设置'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const applyPrompt = async () => {
    if (!promptDraft) return
    setBusy('prompt')
    try {
      const next = await savePrompt({
        mode: promptDraft.mode,
        // 正文清空 = 回到文件 / 内置默认（后端语义），所以空串要回 null
        text: promptDraft.text.trim() ? promptDraft.text : null,
      })
      adoptPrompt(next)
      store.toast(t('已保存系统提示词'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const toggleRole = async (next: boolean) => {
    setRole(next)
    setBusy('role')
    try {
      const result = await saveRoleCompat(next)
      setRole(Boolean(result?.developerRoleCompat))
      store.toast(next ? t('开发者角色兼容已开启') : t('开发者角色兼容已关闭'))
    } catch (failure) {
      setRole(!next)
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const toggleDebug = async (next: boolean) => {
    setDebug(current => (current ? { ...current, debugMode: next } : current))
    setBusy('debug')
    try {
      const result = await saveDebug(next)
      if (result) setDebug(result)
      store.toast(next ? t('调试模式已开启') : t('调试模式已关闭'))
    } catch (failure) {
      setDebug(current => (current ? { ...current, debugMode: !next } : current))
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const clearProviderOverride = async (id: string) => {
    setBusy(`provider:${id}`)
    try {
      const next = await savePrompt({ providers: { [id]: null } })
      adoptPrompt(next)
      store.toast(t('「{name}」已恢复跟随全局', { name: providerLabel(id) }))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  /** 保存单家覆盖：providers 里只送这一家，其余字段网关会保留原值。 */
  const saveProviderOverride = async () => {
    if (!provTarget) {
      store.toast(t('先选一个提供商'), 'err')
      return
    }
    setBusy(`provider:${provTarget}`)
    try {
      const next = await savePrompt({
        providers: {
          [provTarget]: {
            mode: provMode,
            text: provMode === 'passthrough' ? '' : provText,
          },
        },
      })
      adoptPrompt(next)
      setProvSheet(false)
      store.toast(t('已为{name}设置覆盖', { name: providerLabel(provTarget) }))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const ruleCount = sanitizeDraft?.rules.length || 0
  const providerOptions = sanitize?.providerOptions || []
  const selectedProviders = sanitizeDraft?.providers || []
  const scopeAll = selectedProviders.length === 0
  const overlap: Record<string, PromptBlock> = prompt?.promptProviders || {}

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageIntro
        subtitle={t('指纹脱敏 · 角色兼容 · 系统提示词 · 调试')}
        actions={<IconButton name='refresh' label={t('刷新')} onClick={() => void load(true)} />}
      />

      {error ? <ErrorNote text={error} /> : null}
      {loading && !sanitize ? <SkeletonList rows={4} height={72} /> : null}

      {/* ── 指纹脱敏 ─────────────────────────────────────────── */}
      {sanitizeDraft ? (
        <div className='m-section' style={{ marginTop: 0 }}>
          <SectionHead title={t('指纹脱敏')} />
          <Card className='m-card m-card-pad'>
            <SwitchRow
              title={t('剥离上游审核黑名单指纹')}
              sub={t('改写请求体里的模板句与表头')}
              checked={sanitizeDraft.enabled}
              onChange={next => patchSanitize(current => ({ ...current, enabled: next }))}
            />
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.65 }}>
              {t('已启用 {n} 条规则，应用于{scope}', {
                n: ruleCount,
                scope: scopeAll ? t('全部提供商') : t('{n} 个指定提供商', { n: selectedProviders.length }),
              })}
            </div>
          </Card>

          <Card className='m-card m-card-pad' style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{t('应用提供商')}</div>
            <SegmentedControl
              options={[{ value: 'all', label: t('全部提供商') }, { value: 'some', label: t('指定提供商') }]}
              value={scopeAll ? 'all' : 'some'}
              aria-label={t('应用提供商')}
              onValueChange={value => patchSanitize(current => ({
                ...current,
                // 切回「全部」= 清空选择（后端约定：空数组就是全部）
                providers: value === 'all' ? [] : (current.providers.length ? current.providers : []),
              }))}
            />
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('默认应用全部提供商（含之后新增的插件与自定义提供商）。指定后，未选中的提供商不做指纹脱敏；清空选择自动回到全部提供商。')}
            </div>
            {!scopeAll ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                {providerOptions.length ? providerOptions.map(option => {
                  const active = selectedProviders.includes(option.id)
                  return (
                    <Button
                      key={option.id}
                      size='default'
                      variant={active ? 'default' : 'outline'}
                      type='button'
                      className='h-auto min-h-[30px] shrink-0 rounded-full px-3 text-[11.5px]'
                      onClick={() => patchSanitize(current => ({
                        ...current,
                        providers: active
                          ? current.providers.filter(id => id !== option.id)
                          : [...current.providers, option.id],
                      }))}
                    >
                      {providerLabel(option.id, option.label)}
                    </Button>
                  )
                }) : <Empty text={t('网关没报告任何提供商')} />}
              </div>
            ) : null}
          </Card>

          <Card className='m-card' style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px 8px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t('脱敏词表')}</div>
                <div style={{ fontSize: 11, color: 'var(--m-text-3)', marginTop: 2 }}>
                  {t('{n} 条规则，按列表顺序执行', { n: ruleCount })}
                </div>
              </div>
              <Button size='touch-sm' variant='outline' type='button' className='m-btn m-sm m-ghost'
                onClick={() => setRuleSheet('new')} style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}>
                <Icon name='plus' style={{ width: 12, height: 12 }} />
                {t('新增')}
              </Button>
              <Button size='touch-sm' variant='outline' type='button' className='m-btn m-sm m-ghost'
                onClick={() => patchSanitize(current => ({ ...current, rules: (sanitize?.defaultRules || []).map(rule => ({ ...rule })) }))}
                style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}>
                {t('恢复内置')}
              </Button>
            </div>
            {sanitizeDraft.rules.length ? sanitizeDraft.rules.map(rule => (
              <div key={rule.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--m-line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className='m-t1' style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.name || rule.id}
                  </div>
                  <div className='m-t2 m-mono' style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.matchType === 'regex' ? 're:' : ''}{rule.pattern}
                  </div>
                </div>
                <Button size='icon-sm' variant='ghost' type='button' className='m-icon-btn'
                  aria-label={t('编辑规则')} onClick={() => setRuleSheet(rule)}>
                  <Icon name='edit' style={{ width: 15, height: 15 }} />
                </Button>
                <UiSwitch
                  size='touch'
                  variant='success'
                  checked={rule.enabled !== false}
                  aria-label={rule.name || rule.id}
                  onCheckedChange={next => patchSanitize(current => ({
                    ...current,
                    rules: current.rules.map(item => (item.id === rule.id ? { ...item, enabled: next } : item)),
                  }))}
                />
              </div>
            )) : <Empty text={t('词表是空的：不会改写任何内容')} />}
          </Card>

          <div style={{ marginTop: 10 }}>
            <Button size='touch' variant='default' className='m-btn w-full' disabled={busy === 'sanitize' || !sanitizeDirty} onClick={() => void applySanitize()}>
              {busy === 'sanitize' ? t('正在保存…') : sanitizeDirty ? t('保存设置') : t('当前设置已保存')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── 开发者角色兼容 ───────────────────────────────────── */}
      {role !== null ? (
        <div className='m-section'>
          <SectionHead title={t('开发者角色兼容')} />
          <Card className='m-card m-card-pad'>
            <SwitchRow
              title={t('转发前把 developer 角色消息改写为 system')}
              sub={t('兼容不支持 developer 角色的 OpenAI 兼容上游')}
              checked={role}
              disabled={busy === 'role'}
              onChange={next => void toggleRole(next)}
            />
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.65 }}>
              {role ? t('正在归一角色：developer 角色消息转发前改写为 system。') : t('已关闭：developer 角色消息原样发往上游。')}
            </div>
          </Card>
        </div>
      ) : null}

      {/* ── 重试 / 超时 / 排队等待 ───────────────────────────── */}
      {retryDraft ? (
        <div className='m-section'>
          <SectionHead title={t('重试')} />
          <Card className='m-card m-card-pad'>
            <NumberField
              label={t('同账号重试次数')}
              hint={t('0–10 次；0 = 失败直接换号，不在同一账号上重试')}
              value={retryDraft.retryCount}
              onChange={next => setRetryDraft(current => ({ ...current!, retryCount: next }))}
            />
            <NumberField
              label={t('跨提供商重试次数')}
              hint={t('换到下一家提供商后允许的重试次数')}
              value={retryDraft.retryCrossProviderCount}
              onChange={next => setRetryDraft(current => ({ ...current!, retryCrossProviderCount: next }))}
            />
            <NumberField
              label={t('重试间隔')}
              unit={t('秒')}
              hint={t('两次重试之间的等待；0 = 不等待')}
              value={retryDraft.retryIntervalSeconds}
              onChange={next => setRetryDraft(current => ({ ...current!, retryIntervalSeconds: next }))}
            />
            <SaveBar
              busy={busy === 'retry'}
              dirty={retryDirty}
              label={t('保存重试设置')}
              onSave={() => void applyNumbers('retry', retryDraft, RETRY_FIELDS, saveRetries as never, setRetryDraft)}
            />
          </Card>
        </div>
      ) : null}

      {timeoutDraft ? (
        <div className='m-section'>
          <SectionHead title={t('超时')} />
          <Card className='m-card m-card-pad'>
            <NumberField
              label={t('连接超时')}
              unit={t('秒')}
              hint={t('5–3600 秒；建立 TCP/TLS 的连接上限')}
              value={timeoutDraft.connectTimeoutSeconds}
              onChange={next => setTimeoutDraft(current => ({ ...current!, connectTimeoutSeconds: next }))}
            />
            <NumberField
              label={t('响应头超时')}
              unit={t('秒')}
              hint={t('发出请求到收到响应头的时间上限')}
              value={timeoutDraft.headersTimeoutSeconds}
              onChange={next => setTimeoutDraft(current => ({ ...current!, headersTimeoutSeconds: next }))}
            />
            <NumberField
              label={t('流式空闲超时')}
              unit={t('秒')}
              hint={t('SSE 相邻两个分片之间允许的最长间隔')}
              value={timeoutDraft.streamIdleTimeoutSeconds}
              onChange={next => setTimeoutDraft(current => ({ ...current!, streamIdleTimeoutSeconds: next }))}
            />
            <NumberField
              label={t('响应体超时')}
              unit={t('秒')}
              hint={t('非流式响应读完整个体的时间上限')}
              value={timeoutDraft.bodyTimeoutSeconds}
              onChange={next => setTimeoutDraft(current => ({ ...current!, bodyTimeoutSeconds: next }))}
            />
            <SaveBar
              busy={busy === 'timeout'}
              dirty={timeoutDirty}
              label={t('保存超时设置')}
              onSave={() => void applyNumbers('timeout', timeoutDraft, TIMEOUT_FIELDS, saveTimeouts as never, setTimeoutDraft)}
            />
          </Card>
        </div>
      ) : null}

      {queueDraft ? (
        <div className='m-section'>
          <SectionHead title={t('排队等待')} />
          <Card className='m-card m-card-pad'>
            <NumberField
              label={t('排队等待次数')}
              unit={t('次')}
              hint={t('上游繁忙时先排队再重发，最多等几次；0 = 直接返回 503')}
              value={queueDraft.queueMaxWaits}
              onChange={next => setQueueDraft(current => ({ ...current!, queueMaxWaits: next }))}
            />
            <NumberField
              label={t('每次等待时长')}
              unit={t('秒')}
              hint={t('0 = 跟随上游建议（实测 9–30 秒）；可填 0–120 秒强制固定')}
              value={queueDraft.queueWaitSeconds}
              onChange={next => setQueueDraft(current => ({ ...current!, queueWaitSeconds: next }))}
            />
            <SaveBar
              busy={busy === 'queue'}
              dirty={queueDirty}
              label={t('保存排队设置')}
              onSave={() => void applyNumbers('queue', queueDraft, QUEUE_FIELDS, saveQueueSettings as never, setQueueDraft)}
            />
          </Card>
        </div>
      ) : null}

      {/* ── 系统提示词 ───────────────────────────────────────── */}
      {promptDraft && prompt ? (
        <div className='m-section'>
          <SectionHead title={t('系统提示词')} />
          <Card className='m-card m-card-pad'>
            <SegmentedControl
              options={PROMPT_MODES.map(item => ({ value: item.value, label: item.label }))}
              value={promptDraft.mode}
              aria-label={t('系统提示词模式')}
              onValueChange={value => setPromptDraft(current => (current ? { ...current, mode: value as PromptMode } : current))}
            />
            <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.65 }}>
              {PROMPT_MODES.find(item => item.value === promptDraft.mode)?.hint}
            </div>
            {prompt.degradeActive ? (
              <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--m-warn)', lineHeight: 1.6 }}>
                {t('上游刚才拒绝了这份提示词，网关自动降级中')}
                {prompt.degradeUntilText ? ` · ${t('{time} 恢复', { time: prompt.degradeUntilText })}` : ''}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <Badge tone='mute'>{t('生效来源：{v}', { v: promptSourceLabel(prompt.promptSource) })}</Badge>
              <Badge tone='mute'>{t('{n} 行', { n: prompt.promptLines ?? (promptDraft.text ? promptDraft.text.split('\n').length : 0) })}</Badge>
              {prompt.promptFile ? <Badge tone='mute'>{t('文件：{v}', { v: prompt.promptFile })}</Badge> : null}
            </div>
            {prompt.promptFileError ? (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--m-danger)', lineHeight: 1.6 }}>{prompt.promptFileError}</div>
            ) : null}
            <Button
              size='touch'
              variant='outline'
              type='button'
              className='m-btn m-ghost w-full'
              style={{ marginTop: 10 }}
              onClick={() => { setTextDraft(promptDraft.text); setTextSheet(true) }}
            >
              <Icon name='edit' style={{ width: 14, height: 14 }} />
              {t('编辑提示词正文')}
            </Button>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('在这里直接编辑提示词正文：保存后以这份文本为准（优先于提示词文件），清空则回到文件 / 内置默认。')}
            </div>
          </Card>

          <Card className='m-card' style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px 6px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t('按提供商覆盖')}</div>
                <div style={{ fontSize: 11, color: 'var(--m-text-3)', marginTop: 2, lineHeight: 1.5 }}>
                  {t('只让指定的几家走单独模式或单独正文，其余仍按上面的全局设置。')}
                </div>
              </div>
              <Button
                size='touch-sm'
                variant='outline'
                type='button'
                className='m-btn m-sm m-ghost'
                onClick={() => {
                  const covered = new Set(Object.keys(overlap))
                  const free = (prompt?.promptProviderOptions || []).find(item => !covered.has(item.id))
                  if (!free) {
                    store.toast(t('每家都已单独设置'), 'err')
                    return
                  }
                  setProvTarget(free.id)
                  setProvMode('custom')
                  setProvText('')
                  setProvSheet(true)
                }}
                style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
              >
                <Icon name='plus' style={{ width: 12, height: 12 }} />
                {t('新增')}
              </Button>
            </div>
            {Object.entries(overlap).length ? (
              Object.entries(overlap).map(([id, block]) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderTop: '1px solid var(--m-line)' }}>
                  <ProviderLogo id={id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className='m-t1' style={{ fontSize: 12.5 }}>{providerLabel(id)}</div>
                    <div className='m-t2' style={{ fontSize: 11 }}>
                      {PROMPT_MODES.find(item => item.value === block.promptMode)?.label || block.promptMode}
                      {' · '}
                      {t('{n} 行', { n: block.promptLines ?? 0 })}
                    </div>
                  </div>
                  <Button
                    size='touch-sm'
                    variant='outline'
                    type='button'
                    className='m-btn m-sm m-ghost'
                    disabled={busy === `provider:${id}`}
                    onClick={() => {
                      setProvTarget(id)
                      setProvMode((block.promptMode as PromptMode) || 'custom')
                      setProvText(block.promptText || '')
                      setProvSheet(true)
                    }}
                    style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
                  >
                    {t('编辑')}
                  </Button>
                  <Button
                    size='touch-sm'
                    variant='outline'
                    type='button'
                    className='m-btn m-sm m-ghost'
                    disabled={busy === `provider:${id}`}
                    onClick={() => void clearProviderOverride(id)}
                    style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
                  >
                    {t('恢复全局')}
                  </Button>
                </div>
              ))
            ) : (
              <div style={{ padding: '4px 14px 12px', fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
                {t('还没有单独设置。点「新增」可以让某一家用不同的提示词或模式。')}
              </div>
            )}
          </Card>

          <div style={{ marginTop: 10 }}>
            <Button size='touch' variant='default' className='m-btn w-full' disabled={busy === 'prompt' || !promptDirty} onClick={() => void applyPrompt()}>
              {busy === 'prompt' ? t('正在保存…') : promptDirty ? t('保存提示词') : t('当前设置已保存')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── 出站行为 ─────────────────────────────────────────── */}
      {cors !== null || stripKeepalive !== null || autoContinue ? (
        <div className='m-section'>
          <SectionHead title={t('出站行为')} />
          {cors !== null ? (
            <Card className='m-card m-card-pad'>
              <SwitchRow
                title={t('允许跨域访问 /v1/*')}
                sub={t('给网页前端直连网关时用；不需要就关着')}
                checked={cors}
                disabled={busy === 'cors'}
                onChange={(next: boolean) => void flip('cors', next, setCors, saveCors, next ? t('已开启跨域') : t('已关闭跨域'))}
              />
            </Card>
          ) : null}

          {stripKeepalive !== null ? (
            <Card className='m-card m-card-pad' style={{ marginTop: 10 }}>
              <SwitchRow
                title={t('丢掉只含换行的保活分片')}
                sub={t('上游用空行维持连接时，不再把它转给客户端')}
                checked={stripKeepalive}
                disabled={busy === 'strip'}
                onChange={(next: boolean) => void flip('strip', next, setStripKeepalive, saveKeepaliveStrip, next ? t('已开启') : t('已关闭'))}
              />
            </Card>
          ) : null}

          {autoContinue ? (
            <Card className='m-card m-card-pad' style={{ marginTop: 10 }}>
              <SwitchRow
                title={t('自动继续被截断的回复')}
                sub={t('上游因长度停止时自动续写，最多 {n} 轮', { n: autoContinue.autoContinueMaxRounds || 0 })}
                checked={Boolean(autoContinue.autoContinue)}
                disabled={busy === 'auto'}
                onChange={(next: boolean) => {
                  const previous = autoContinue
                  setAutoContinue({ ...autoContinue, autoContinue: next })
                  setBusy('auto')
                  void saveAutoContinue({ autoContinue: next })
                    .then(result => { if (result) setAutoContinue(result); store.toast(next ? t('已开启自动续写') : t('已关闭自动续写')) })
                    .catch((failure: unknown) => {
                      setAutoContinue(previous)
                      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
                    })
                    .finally(() => setBusy(''))
                }}
              />
              <NumberField
                label={t('最多续写轮数')}
                unit={t('轮')}
                hint={t('1–10；调大能救长文，但也更容易超出额度')}
                value={String(autoContinue.autoContinueMaxRounds ?? '')}
                onChange={next => setAutoContinue({ ...autoContinue, autoContinueMaxRounds: Number(next) || 0 })}
              />
              <Button
                size='touch'
                variant='outline'
                className='m-btn m-ghost w-full'
                style={{ marginTop: 8 }}
                disabled={busy === 'auto-save'}
                onClick={() => {
                  setBusy('auto-save')
                  void saveAutoContinue({ autoContinueMaxRounds: autoContinue.autoContinueMaxRounds })
                    .then(result => { if (result) setAutoContinue(result); store.toast(t('已保存续写轮数')) })
                    .catch((failure: unknown) => store.toast(failure instanceof Error ? failure.message : String(failure), 'err'))
                    .finally(() => setBusy(''))
                }}
              >
                {t('保存续写轮数')}
              </Button>
            </Card>
          ) : null}

          {zcode !== null ? (
            <Card className='m-card m-card-pad' style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 550 }}>{t('ZCode 客户端版本号')}</div>
              <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 3, lineHeight: 1.5 }}>
                {t('网关声明给上游的客户端版本；留空 = 跟随内置默认')}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Input
                  value={zcode}
                  onChange={event => setZcode(event.target.value)}
                  placeholder='3.4.2'
                  aria-label={t('ZCode 客户端版本号')}
                  style={{ flex: 1, height: 36, fontFamily: 'var(--m-mono)' }}
                />
                <Button
                  size='touch-sm'
                  variant='outline'
                  className='m-btn m-sm m-ghost'
                  disabled={busy === 'zcode'}
                  onClick={() => {
                    setBusy('zcode')
                    void saveZcodeVersion(zcode)
                      .then(result => { if (result) setZcode(String(result.version ?? '')); store.toast(t('已保存版本号')) })
                      .catch((failure: unknown) => store.toast(failure instanceof Error ? failure.message : String(failure), 'err'))
                      .finally(() => setBusy(''))
                  }}
                  style={{ height: 36, padding: '0 14px' }}
                >
                  {t('保存')}
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}



      {/* ── 调试模式 ─────────────────────────────────────────── */}
      {debug ? (
        <div className='m-section'>
          <SectionHead title={t('调试模式')} />
          <Card className='m-card m-card-pad'>
            <SwitchRow
              title={t('保存上游原始报文')}
              sub={t('请求与响应全文落盘，凭据类头已脱敏')}
              checked={Boolean(debug.debugMode)}
              disabled={busy === 'debug'}
              onChange={next => void toggleDebug(next)}
            />
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.65 }}>
              {t('已存 {n} / {limit} 条', { n: debug.count ?? 0, limit: debug.limit ?? 0 })}
              {' · '}
              {t('请求日志页的「详情」列据此展示')}
            </div>
          </Card>
        </div>
      ) : null}

      <div className='m-section' style={{ paddingBottom: 8 }}>
        <Card className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
          {t('四组设置都是改完下一个请求立即生效，不用重启网关。它们改写的是发给上游的副本，客户端看到的响应不受影响。')}
        </Card>
      </div>

      {/* 规则编辑 */}
      {ruleSheet ? (
        <RuleSheet
          rule={ruleSheet === 'new' ? null : ruleSheet}
          limits={sanitize?.limits}
          onClose={() => setRuleSheet(null)}
          onDelete={id => {
            patchSanitize(current => ({ ...current, rules: current.rules.filter(item => item.id !== id) }))
            setRuleSheet(null)
          }}
          onSave={rule => {
            patchSanitize(current => ({
              ...current,
              rules: ruleSheet === 'new'
                ? [...current.rules, rule]
                : current.rules.map(item => (item.id === rule.id ? rule : item)),
            }))
            setRuleSheet(null)
          }}
        />
      ) : null}

      {/* 提示词正文 */}
      {textSheet ? (
        <Sheet open onOpenChange={open => { if (!open) setTextSheet(false) }}>
          <SheetContent className='h-[88vh]'>
            <SheetHeader>
              <SheetTitle>{t('提示词正文')}</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <Textarea
                value={textDraft}
                onChange={event => setTextDraft(event.target.value)}
                placeholder={t('留空 = 回到提示词文件 / 内置默认')}
                style={{ minHeight: '46vh', fontFamily: 'var(--m-mono)', fontSize: 12.5, lineHeight: 1.7 }}
              />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--m-text-3)' }}>
                {t('当前 {n} 行 · 只对「替换 / 追加」模式生效', { n: textDraft ? textDraft.split('\n').length : 0 })}
              </div>
            </SheetBody>
            <SheetFooter>
              <Button size='touch' variant='outline' className='flex-1' onClick={() => setTextSheet(false)}>{t('取消')}</Button>
              <Button size='touch' className='flex-1' onClick={() => {
                setPromptDraft(current => (current ? { ...current, text: textDraft } : current))
                setTextSheet(false)
              }}>{t('确定')}</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}

      {provSheet ? (
        <Sheet open onOpenChange={open => { if (!open) setProvSheet(false) }}>
          <SheetContent className='h-[86vh]'>
            <SheetHeader>
              <SheetTitle>{t('按提供商覆盖')}</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.65 }}>
                {t('只对这一家生效。其余提供商继续用上面的全局模式。')}
              </div>

              <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 550 }}>{t('提供商')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {(prompt?.promptProviderOptions || []).map(option => {
                  const active = option.id === provTarget
                  return (
                    <button
                      key={option.id}
                      type='button'
                      aria-pressed={active}
                      onClick={() => setProvTarget(option.id)}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 999,
                        fontSize: 12,
                        border: `1px solid ${active ? 'var(--m-primary)' : 'var(--m-line)'}`,
                        background: active ? 'var(--m-primary-soft)' : 'transparent',
                        color: active ? 'var(--m-text)' : 'var(--m-text-2)',
                      }}
                    >
                      {option.label || providerLabel(option.id)}
                    </button>
                  )
                })}
              </div>

              <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 550 }}>{t('模式')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {PROMPT_MODES.map(item => (
                  <button
                    key={item.value}
                    type='button'
                    aria-pressed={provMode === item.value}
                    onClick={() => setProvMode(item.value)}
                    style={{
                      textAlign: 'left',
                      padding: '9px 12px',
                      borderRadius: 10,
                      fontSize: 12.5,
                      border: `1px solid ${provMode === item.value ? 'var(--m-primary)' : 'var(--m-line)'}`,
                      background: provMode === item.value ? 'var(--m-primary-soft)' : 'transparent',
                    }}
                  >
                    <div style={{ fontWeight: 550 }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--m-text-3)', marginTop: 2, lineHeight: 1.5 }}>{item.hint}</div>
                  </button>
                ))}
              </div>

              {provMode !== 'passthrough' ? (
                <>
                  <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 550 }}>{t('提示词正文')}</div>
                  <Textarea
                    value={provText}
                    onChange={event => setProvText(event.target.value)}
                    placeholder={t('留空 = 跟随全局正文 / 提示词文件 / 内置默认')}
                    style={{ minHeight: '22vh', marginTop: 8, fontFamily: 'var(--m-mono)', fontSize: 12.5, lineHeight: 1.7 }}
                  />
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--m-text-3)' }}>
                    {t('当前 {n} 行', { n: provText ? provText.split('\n').length : 0 })}
                  </div>
                </>
              ) : null}
            </SheetBody>
            <SheetFooter>
              <Button size='touch' variant='outline' className='flex-1' onClick={() => setProvSheet(false)}>{t('取消')}</Button>
              <Button
                size='touch'
                className='flex-1'
                disabled={busy === `provider:${provTarget}`}
                onClick={() => void saveProviderOverride()}
              >
                {busy === `provider:${provTarget}` ? t('保存中…') : t('保存')}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}

/* ── 规则编辑抽屉 ─────────────────────────────────────────── */

function RuleSheet({ rule, limits, onSave, onDelete, onClose }: {
  rule: SanitizeRule | null
  limits?: SanitizeSettings['limits']
  onSave: (rule: SanitizeRule) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(rule?.name || '')
  const [pattern, setPattern] = useState(rule?.pattern || '')
  const [replacement, setReplacement] = useState(rule?.replacement || '')
  const [matchType, setMatchType] = useState<SanitizeMatchType>(rule?.matchType || 'literal')
  const maxName = limits?.maxNameChars || 128
  const maxPattern = limits?.maxPatternChars || 4096
  const maxReplacement = limits?.maxReplacementChars || 4096
  const invalid = !name.trim() || !pattern.trim()

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{rule ? t('编辑脱敏规则') : t('新增脱敏规则')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Label>{t('规则名称')}</Label>
          <Input value={name} maxLength={maxName} onChange={event => setName(event.target.value)} placeholder={t('例：产品名')} />
          <Label style={{ marginTop: 12 }}>{t('匹配方式')}</Label>
          <SegmentedControl
            options={[{ value: 'literal', label: t('字面量') }, { value: 'regex', label: t('正则') }]}
            value={matchType}
            aria-label={t('匹配方式')}
            onValueChange={value => setMatchType(value as SanitizeMatchType)}
          />
          <Label style={{ marginTop: 12 }}>{t('匹配内容')}</Label>
          <Textarea
            value={pattern}
            maxLength={maxPattern}
            onChange={event => setPattern(event.target.value)}
            placeholder={matchType === 'regex' ? t('例：Acme\\s+Cloud') : t('例：Acme Cloud')}
            style={{ minHeight: 76, fontFamily: 'var(--m-mono)', fontSize: 12.5 }}
          />
          <Label style={{ marginTop: 12 }}>{t('替换为（留空 = 删除）')}</Label>
          <Input value={replacement} maxLength={maxReplacement} onChange={event => setReplacement(event.target.value)} placeholder={t('留空即删除匹配内容')} />
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
            {t('规则只改发给上游的副本；正则请先在桌面端验证，写错会在保存时被后端拒绝。')}
          </div>
        </SheetBody>
        <SheetFooter>
          {rule ? (
            <Button size='touch' variant='ghost' className='m-btn m-ghost' onClick={() => onDelete(rule.id)}>{t('删除')}</Button>
          ) : null}
          <Button size='touch' variant='outline' className='flex-1' onClick={onClose}>{t('取消')}</Button>
          <Button
            size='touch'
            className='flex-1'
            disabled={invalid}
            onClick={() => onSave({
              id: rule?.id || `rule_${Date.now().toString(36)}`,
              name: name.trim(),
              pattern,
              replacement,
              matchType,
              enabled: rule?.enabled !== false,
              ...(rule?.roles?.length ? { roles: rule.roles } : {}),
              ...(rule?.repeat ? { repeat: true } : {}),
            })}
          >
            {t('保存规则')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/* ── 小组件 ───────────────────────────────────────────────── */

function SwitchRow({ title, sub, checked, disabled, onChange }: {
  title: string
  sub?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 550, lineHeight: 1.45 }}>{title}</div>
        {sub ? <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 3, lineHeight: 1.5 }}>{sub}</div> : null}
      </div>
      <UiSwitch size='touch' variant='success' checked={checked} disabled={disabled} aria-label={title} onCheckedChange={onChange} />
    </div>
  )
}

/* ── 数值组 ───────────────────────────────────────────────── */

const RETRY_FIELDS = [
  { key: 'retryCount' },
  { key: 'retryCrossProviderCount' },
  { key: 'retryIntervalSeconds' },
]

const TIMEOUT_FIELDS = [
  { key: 'connectTimeoutSeconds' },
  { key: 'headersTimeoutSeconds' },
  { key: 'streamIdleTimeoutSeconds' },
  { key: 'bodyTimeoutSeconds' },
]

const QUEUE_FIELDS = [
  { key: 'queueMaxWaits' },
  { key: 'queueWaitSeconds' },
]

function toNumberDraft(source: Record<string, unknown>, fields: Array<{ key: string }>): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const field of fields) {
    const value = source?.[field.key]
    draft[field.key] = typeof value === 'number' ? String(value) : ''
  }
  return draft
}

function NumberField({ label, value, unit, hint, onChange }: {
  label: string
  value: string
  unit?: string
  hint?: string
  onChange: (next: string) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5 }}>{label}</div>
        {hint ? (
          <div style={{ fontSize: 10.5, color: 'var(--m-text-3)', marginTop: 2, lineHeight: 1.5 }}>{hint}</div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
        <Input
          value={value}
          inputMode='numeric'
          aria-label={label}
          onChange={event => onChange(event.target.value.replace(/[^\d]/g, ''))}
          style={{ width: 76, height: 36, textAlign: 'right', fontFamily: 'var(--m-mono)' }}
        />
        {unit ? <span style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>{unit}</span> : null}
      </div>
    </div>
  )
}

function SaveBar({ busy, dirty, label, onSave }: { busy: boolean; dirty: boolean; label: string; onSave: () => void }) {
  return (
    <Button
      size='touch'
      variant='default'
      className='m-btn w-full'
      style={{ marginTop: 10 }}
      disabled={busy || !dirty}
      onClick={onSave}
    >
      {busy ? '正在保存…' : dirty ? label : '当前设置已保存'}
    </Button>
  )
}

/** 提交前做一次规范化比较：忽略字段顺序与「没写等于默认」的差异 */
function normalizeSanitize(draft: SanitizeDraft): unknown {
  return {
    enabled: draft.enabled,
    providers: [...draft.providers].sort(),
    rules: draft.rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      pattern: rule.pattern,
      replacement: rule.replacement || '',
      matchType: rule.matchType || 'literal',
      enabled: rule.enabled !== false,
    })),
  }
}

function sameRules(left: SanitizeRule[], right: SanitizeRule[]): boolean {
  if (left.length !== right.length) return false
  return JSON.stringify(left.map(rule => [rule.id, rule.pattern, rule.replacement || '', rule.enabled !== false]))
    === JSON.stringify(right.map(rule => [rule.id, rule.pattern, rule.replacement || '', rule.enabled !== false]))
}
