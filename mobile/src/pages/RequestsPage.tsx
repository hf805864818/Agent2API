import { useCallback, useEffect, useRef, useState } from 'react'
import { PageIntro, IconButton, Empty, ErrorNote, SkeletonList } from '../components/ui'
import { ProviderLogo } from '../components/ProviderLogo'
import { Icon } from '../components/Icon'
import { Alert, Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetFooter, Button, Card, SegmentedControl } from '@ui'
import { store, useStore } from '../state/store'
import { fetchRequests, type RequestPage, type RequestRow } from '../api/gateway'
import { ellipsisMiddle, formatClock, formatDuration, formatInt } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { usePolling } from '../lib/usePolling'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { t } from '../i18n'
import { MetricGrid, MetricCard } from '@ui'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { requestApiKeyLabel, requestClientLabel } from '../../../ui-shared/model-api-key'
import { ClientIdentificationDetail } from '../../../ui-shared/client-identification-detail'
import { fetchDebugTraffic, type DebugTraffic } from '../api/gateway-settings'
import { clientIdentificationApi } from '../api/client-identification'
import { dateRangeQuery, readCustomRange, saveCustomRange, validCustomRange, type CustomDates, type DateRange } from '../../../ui-shared/date-range'

/**
 * 请求日志。
 *
 * ── 九列宽表 → 一请求一卡 ────────────────────────────────────
 * 桌面端是「时间 / 提供商·账号 / 重试 / 状态 / 模型 / 客户端 / 用时 / 用量 /
 * 错误 / 详情」十列。手机上每张卡三行：
 *   ① 状态码 + 模型 + 时间
 *   ② 提供商图标 + 名称 + 账号
 *   ③ 用时 · Token · 客户端 · 重试次数
 * 换号链、退避重试、上游报错原本要悬停才看得到，手机上直接铺成卡内提示条
 * —— 这是排查时最需要的信息。
 */

type Filter = 'all' | 'error' | 'retry' | 'running'

const PAGE_SIZE = 20
const CUSTOM_RANGE_KEY = 'agent2api-mobile-requests-custom-range'
const EMPTY_SOURCE_QUERY: Record<string, string> = {}

export function RequestsPage() {
  const { route } = useStore()
  const sourceQuery = route.params || EMPTY_SOURCE_QUERY
  const routeDates = validCustomRange({ start: sourceQuery.startDate, end: sourceQuery.endDate })
  const [range, setRange] = useState<DateRange>(routeDates ? 'custom' : 'all')
  const [dates, setDates] = useState<CustomDates>(() => routeDates || readCustomRange(CUSTOM_RANGE_KEY))
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState<RequestPage | null>(null)
  const [extra, setExtra] = useState<RequestRow[]>([])
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<RequestRow | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const routeParamsRef = useRef(route.params)
  const queryKeyRef = useRef('')
  const seqRef = useRef(0)

  useEffect(() => {
    if (routeParamsRef.current === route.params) return
    routeParamsRef.current = route.params
    const custom = validCustomRange({ start: sourceQuery.startDate, end: sourceQuery.endDate })
    setRange(custom ? 'custom' : 'all')
    setDates(custom || readCustomRange(CUSTOM_RANGE_KEY))
    setExtra([])
  }, [route.params, sourceQuery])

  // 当前筛选对应的服务端 status 参数：失败与在途都走服务端筛选，
  // 这样「加载更早」翻页时不会混进其它状态的记录；「有重试」后端没有对应参数，仍靠客户端过滤。
  const statusParam: 'ok' | 'error' | 'running' | undefined =
    filter === 'error' ? 'error' : filter === 'running' ? 'running' : undefined

  const requestQuery = {
    ...sourceQuery,
    startDate: undefined as string | undefined,
    endDate: undefined as string | undefined,
    ...dateRangeQuery(range, dates),
    completedOnly: filter === 'running' ? undefined : sourceQuery.completedOnly,
    status: statusParam,
  }
  const queryKey = JSON.stringify({ ...requestQuery, filter })
  queryKeyRef.current = queryKey
  const queryRef = useRef(requestQuery)
  queryRef.current = requestQuery

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    const requested = queryKeyRef.current
    try {
      const next = await fetchRequests({ ...queryRef.current, limit: PAGE_SIZE })
      if (seq !== seqRef.current || requested !== queryKeyRef.current) return
      setPage(next)
      setExtra([])
      setError('')
    } catch (failure) {
      if (seq === seqRef.current && requested === queryKeyRef.current) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
  }, [])

  useEffect(() => {
    ++seqRef.current
    setPage(null)
    setExtra([])
    void load()
    return () => { ++seqRef.current }
  }, [queryKey, load])
  usePolling(load, 30_000)

  const pull = usePullToRefresh({ onRefresh: load })

  const rows = [...(page?.entries || []), ...extra]
  const filtered = rows.filter(row => {
    if (filter === 'retry') return (row.attempts || 1) > 1
    if (filter === 'running') return !row.status
    return true
  })

  const loadMore = async () => {
    if (loadingMore) return
    const requested = queryKeyRef.current
    const seq = seqRef.current
    setLoadingMore(true)
    try {
      // offset 用已加载的原始条数：服务端分页按未过滤的行算，
      // 「有重试 / 在途」这类客户端二次过滤不影响翻页基准
      const next = await fetchRequests({ ...queryRef.current, offset: rows.length, limit: PAGE_SIZE })
      if (seq !== seqRef.current || requested !== queryKeyRef.current) return
      setExtra(prev => [...prev, ...(next.entries || [])])
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setLoadingMore(false)
    }
  }

  const total = Number(page?.total) || 0
  const matched = Number(page?.matched) || 0
  const running = Number(page?.running) || 0

  return (
    <div className='m-page m-fixed' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <div className='m-sticky'>
        <PageIntro actions={<IconButton name='refresh' label={t('刷新')} onClick={() => void load()} />}
        />

      <div className='m-section' style={{ marginTop: 0 }}>
        <SegmentedControl value={filter} className='w-full' aria-label={t('请求筛选')}
          options={[
            { value: 'all', label: t('全部') },
            { value: 'error', label: t('失败') },
            { value: 'retry', label: t('有重试') },
            { value: 'running', label: running ? t('在途 {n}', { n: running }) : t('在途') },
          ]} onValueChange={value => setFilter(value as Filter)} />
      </div>
      <DateRangeFilter range={range} dates={dates} onRangeChange={setRange} label={t('请求日志时间范围')}
        onDatesChange={next => { setDates(next); saveCustomRange(CUSTOM_RANGE_KEY, next) }} />
      </div>

      <div className='m-body'>
      {Object.keys(sourceQuery).length ? <div className='m-section text-xs text-muted-foreground'>
        {requestQuery.startDate && requestQuery.endDate ? `${requestQuery.startDate} ～ ${requestQuery.endDate}` : t('全部')}
        {sourceQuery.client !== undefined ? ` · ${requestClientLabel({ client: sourceQuery.client, clientLabel: sourceQuery.clientLabel || rows.find(row => row.client === sourceQuery.client)?.clientLabel }, t)}` : ''}
        {sourceQuery.apiKey ? ` · ${t('API Key')} ${sourceQuery.apiKey}` : ''}
        <Button variant='ghost' size='sm' onClick={() => store.push('requests')}>{t('清除筛选')}</Button>
      </div> : null}
      {error ? <ErrorNote text={error} /> : null}
      {!page ? <SkeletonList rows={4} height={104} /> : null}

      {page && !filtered.length ? (
        <div className='m-section'>
          <Card className='m-card'>
            <Empty text={filter === 'all' ? t('暂无请求日志') : t('当前筛选下没有记录')} />
          </Card>
        </div>
      ) : null}

      <div className='m-section' style={{ marginTop: 12 }}>
        {filtered.map((row, index) => (
          <RequestCard key={row.id || `${row.ts}-${index}`} row={row} onClick={() => setDetail(row)} />
        ))}
      </div>

      {page && rows.length < matched ? (
        <div className='m-section'>
          <Button size='touch' variant='outline' type='button' className='m-btn m-ghost w-full' disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? t('加载中…') : t('加载更早的请求')}
          </Button>
        </div>
      ) : null}

      </div>

      <RequestSheet row={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

function requestKeyName(row: RequestRow): string {
  return requestApiKeyLabel(row, t)
}

function RequestCard({ row, onClick }: { row: RequestRow; onClick: () => void }) {
  const status = Number(row.status) || 0
  const tone = !status ? 'warn' : status >= 200 && status < 400 ? 'ok' : 'bad'
  const note = buildNote(row)
  return (
    <Button size='default' variant='ghost' className='h-auto min-w-0 whitespace-normal [overflow-wrap:anywhere]'
      type='button'
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '11px 13px',
        marginBottom: 9,
        borderRadius: 'var(--m-r-md)',
        background: 'var(--m-surface)',
        border: '1px solid var(--m-line)',
        boxShadow: 'var(--m-shadow-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className='m-mono'
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 5,
            flex: 'none',
            background:
              tone === 'ok' ? 'var(--m-ok-soft)' : tone === 'warn' ? 'var(--m-warn-soft)' : 'var(--m-danger-soft)',
            color: tone === 'ok' ? 'var(--m-ok)' : tone === 'warn' ? 'var(--m-warn)' : 'var(--m-danger)',
          }}
        >
          {status || t('在途')}
        </span>
        <span
          className='m-mono'
          style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {ellipsisMiddle(row.upstreamModel || row.model || '—', 30)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--m-text-3)', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
          {formatClock(row.ts)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11.5, color: 'var(--m-text-3)', minWidth: 0 }}>
        <ProviderLogo id={row.provider} />
        <span className='min-w-0 flex-1 truncate'>{providerLabel(row.provider, row.providerLabel)}</span>
        {row.accountName ? (
          <>
            <span className='shrink-0' style={{ opacity: 0.45 }}>·</span>
            <span className='min-w-0 flex-1 truncate'>
              {row.accountName}
            </span>
          </>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 11, color: 'var(--m-text-3)', fontVariantNumeric: 'tabular-nums' }}>
        <span>{formatDuration(row.durationMs)}</span>
        <span style={{ opacity: 0.45 }}>·</span>
        <span>{formatInt(Number(row.totalTokens) || 0)} tokens</span>
        {(row.attempts || 1) > 1 ? (
          <>
            <span style={{ opacity: 0.45 }}>·</span>
            <span>{t('重试 {n}', { n: (row.attempts || 1) - 1 })}</span>
          </>
        ) : null}
      </div>

      <div className='mt-1 text-xs text-muted-foreground truncate'>
        {requestClientLabel(row, t)} · {requestKeyName(row)}
      </div>
      {note ? (
        <div
          style={{
            marginTop: 8,
            padding: '7px 9px',
            borderRadius: 8,
            fontSize: 11.3,
            lineHeight: 1.5,
            background:
              note.tone === 'bad' ? 'var(--m-danger-soft)' : note.tone === 'warn' ? 'var(--m-warn-soft)' : 'var(--m-surface-2)',
            color:
              note.tone === 'bad'
                ? 'color-mix(in srgb, var(--m-danger) 72%, var(--m-text))'
                : note.tone === 'warn'
                  ? 'color-mix(in srgb, var(--m-warn) 72%, var(--m-text))'
                  : 'var(--m-text-2)',
          }}
        >
          {note.text}
        </div>
      ) : null}
    </Button>
  )
}

function buildNote(row: RequestRow): { text: string; tone: 'mute' | 'warn' | 'bad' } | null {
  const attempts = row.attempts || 1
  const details = Array.isArray(row.attemptDetails) ? row.attemptDetails : []
  const failed = details.filter(item => Number(item.status) >= 400)
  if (row.error) {
    return { text: row.error, tone: Number(row.status) >= 400 ? 'bad' : 'warn' }
  }
  if (attempts > 1) {
    const chain = details
      .map(item => `${providerLabel(item.provider)} ${item.status || ''}`.trim())
      .join(' → ')
    return {
      text: chain ? t('换号链：{chain}', { chain }) : t('重试 {n} 次', { n: attempts - 1 }),
      tone: failed.length ? 'warn' : 'mute',
    }
  }
  const hits = Array.isArray(row.sensitiveHits) ? row.sensitiveHits : []
  if (hits.length) {
    return { text: t('脱敏命中：{words}', { words: hits.map(item => item.word).join('、') }), tone: 'mute' }
  }
  if (row.clientModel && row.upstreamModel && row.clientModel !== row.upstreamModel) {
    return { text: t('模型映射：{from} → {to}', { from: row.clientModel, to: row.upstreamModel }), tone: 'mute' }
  }
  return null
}

function RequestSheet({ row, onClose }: { row: RequestRow | null; onClose: () => void }) {
  const details = Array.isArray(row?.attemptDetails) ? row?.attemptDetails || [] : []
  return (
    <Sheet open={Boolean(row)} onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('请求详情')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {row ? (
            <>
              <MetricGrid className='m-kv'>
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('状态')}</div>
                  <div
                    className='v'
                    style={{
                      color:
                        !row.status
                          ? 'var(--m-warn)'
                          : row.status < 400
                            ? 'var(--m-ok)'
                            : 'var(--m-danger)',
                    }}
                  >
                    {row.status || t('在途')}
                  </div>
                </MetricCard>
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('用时')}</div>
                  <div className='v'>{formatDuration(row.durationMs)}</div>
                </MetricCard>
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('输入 Token')}</div>
                  <div className='v'>{formatInt(Number(row.promptTokens) || 0)}</div>
                </MetricCard>
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('输出 Token')}</div>
                  <div className='v'>{formatInt(Number(row.completionTokens) || 0)}</div>
                </MetricCard>
              </MetricGrid>

              <div className='rounded-lg border border-hairline p-3'>
                <ClientIdentificationDetail key={row.id || row.ts} entry={row} api={clientIdentificationApi} t={t} />
              </div>
              <div className='m-rows'>
                <div className='m-row'><span className='m-k'>{t('客户端')}</span><span className='m-v'>{requestClientLabel(row, t)}</span></div>
                <div className='m-row'><span className='m-k'>{t('API Key')}</span><span className='m-v'>{requestKeyName(row)}</span></div>
                <div className='m-row'>
                  <span className='m-k'>{t('模型')}</span>
                  <span className='m-v m-mono' style={{ fontSize: 11 }}>
                    {row.model || '—'}
                  </span>
                </div>
                {row.clientModel ? (
                  <div className='m-row'>
                    <span className='m-k'>{t('客户端请求的模型')}</span>
                    <span className='m-v m-mono' style={{ fontSize: 11 }}>
                      {row.clientModel}
                    </span>
                  </div>
                ) : null}
                {row.upstreamModel ? (
                  <div className='m-row'>
                    <span className='m-k'>{t('发给上游的模型')}</span>
                    <span className='m-v m-mono' style={{ fontSize: 11 }}>
                      {row.upstreamModel}
                    </span>
                  </div>
                ) : null}
                <div className='m-row'>
                  <span className='m-k'>{t('提供商')}</span>
                  <span className='m-v'>{providerLabel(row.provider, row.providerLabel)}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('账号')}</span>
                  <span className='m-v'>{row.accountName || '—'}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('尝试次数')}</span>
                  <span className='m-v'>{row.attempts || 1}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('首响')}</span>
                  <span className='m-v'>{formatDuration(row.firstResponseMs ?? null)}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('时间')}</span>
                  <span className='m-v m-mono' style={{ fontSize: 11 }}>
                    {row.ts ? new Date(row.ts).toLocaleString('zh-CN', { hour12: false }) : '—'}
                  </span>
                </div>
              </div>

              {details.length ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--m-text-2)' }}>{t('尝试链')}</div>
                  <div className='m-rows'>
                    {details.map((item, index) => (
                      <div key={index} className='m-row'>
                        <span className='m-k'>#{index + 1}</span>
                        <span className='m-v' style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          {providerLabel(item.provider)} · {item.status || '—'}
                          {item.error ? (
                            <span style={{ display: 'block', color: 'var(--m-danger)', fontSize: 11, marginTop: 2 }}>
                              {item.error}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <TrafficBlock rowId={row.id} />

              {row.error ? <Alert variant='destructive'>{row.error}</Alert> : null}
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button size='touch' variant='outline' type='button' className='m-btn m-ghost w-full' onClick={onClose}>
            {t('关闭')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}


/**
 * 原始报文。
 *
 * 桌面端「请求日志 → 详情」里有这一块：调试模式开启时，网关把发给上游的
 * 请求与上游返回的响应整份落盘，排查「客户端到底发了什么」只能靠它。
 *
 * 手机上必须做成**按需加载**：一条完整 SSE 响应可达数百 KB，列表里预取会
 * 把内存和流量都吃掉；而且绝大多数请求根本没有存档（调试模式当时没开），
 * 预取等于给每条记录发一个注定 404 的请求。
 */
function TrafficBlock({ rowId }: { rowId?: string }) {
  const [data, setData] = useState<DebugTraffic | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'missing' | 'error'>('idle')
  const [error, setError] = useState('')
  const [open, setOpen] = useState<'request' | 'response' | ''>('')
  const [copied, setCopied] = useState('')

  const load = async () => {
    if (!rowId) {
      setState('missing')
      return
    }
    setState('loading')
    setError('')
    try {
      const next = await fetchDebugTraffic(rowId)
      setData(next)
      setState('idle')
      // 默认展开请求体：用户点「查看原始报文」十有八九就是要看发给上游的内容
      setOpen('request')
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      // 404 = 没存档（当时没开调试模式 / 超出保留条数），不是故障
      if (/未保存|404|没有保存/.test(message)) setState('missing')
      else {
        setState('error')
        setError(message)
      }
    }
  }

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      store.toast(t('复制失败：浏览器不允许访问剪贴板'), 'err')
    }
  }

  if (!rowId) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--m-text-2)', flex: 1 }}>
          {t('原始报文')}
        </div>
        {data ? (
          <Button size='touch-sm' variant='outline' type='button' className='m-btn m-sm m-ghost'
            style={{ height: 28, fontSize: 11.5, padding: '0 10px' }} onClick={() => void load()}>
            {t('重新读取')}
          </Button>
        ) : (
          <Button size='touch-sm' variant='outline' type='button' className='m-btn m-sm m-ghost'
            style={{ height: 28, fontSize: 11.5, padding: '0 10px' }} disabled={state === 'loading'} onClick={() => void load()}>
            {state === 'loading' ? t('读取中…') : t('查看原始报文')}
          </Button>
        )}
      </div>

      {state === 'missing' ? (
        <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
          {t('该请求没有保存原始报文（调试模式当时未开启，或记录已超出保留条数）。到「网关设置 → 调试模式」打开后，新请求才会有存档。')}
        </div>
      ) : null}
      {state === 'error' ? <div style={{ fontSize: 11.5, color: 'var(--m-danger)' }}>{error}</div> : null}

      {data ? (
        <>
          {data.truncated ? (
            <div style={{ fontSize: 11, color: 'var(--m-warn)' }}>
              {t('报文过大已被截断，只保留开头部分')}
            </div>
          ) : null}
          <TrafficSection
            label={t('请求（发给上游）')}
            meta={[data.url, data.provider].filter(Boolean).join(' · ')}
            headers={data.requestHeaders}
            body={data.requestBody || ''}
            open={open === 'request'}
            onToggle={() => setOpen(open === 'request' ? '' : 'request')}
            onCopy={() => void copy('request', `${formatHeaders(data.requestHeaders)}\n\n${data.requestBody || ''}`)}
            copied={copied === 'request'}
          />
          <TrafficSection
            label={t('响应（上游返回）')}
            meta={data.status ? `HTTP ${data.status}` : ''}
            headers={data.responseHeaders}
            body={data.responseBody || ''}
            open={open === 'response'}
            onToggle={() => setOpen(open === 'response' ? '' : 'response')}
            onCopy={() => void copy('response', `${formatHeaders(data.responseHeaders)}\n\n${data.responseBody || ''}`)}
            copied={copied === 'response'}
          />
        </>
      ) : null}
    </div>
  )
}

function TrafficSection({ label, meta, headers, body, open, onToggle, onCopy, copied }: {
  label: string
  meta?: string
  headers?: Record<string, string> | string
  body: string
  open: boolean
  onToggle: () => void
  onCopy: () => void
  copied: boolean
}) {
  const headerText = formatHeaders(headers)
  return (
    <div style={{ border: '1px solid var(--m-line)', borderRadius: 12, overflow: 'hidden' }}>
      <Button
        size='default'
        variant='ghost'
        type='button'
        className='h-auto w-full justify-start rounded-none border-0 px-3 py-2.5 text-left'
        onClick={onToggle}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
          {meta ? (
            <div className='m-mono' style={{ fontSize: 10.5, color: 'var(--m-text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meta}
            </div>
          ) : null}
        </div>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>
          <Icon name='chev' style={{ width: 14, height: 14 }} />
        </span>
      </Button>
      {open ? (
        <div style={{ borderTop: '1px solid var(--m-line)', padding: '8px 10px 10px' }}>
          {headerText ? (
            <pre style={trafficPreStyle}>{headerText}</pre>
          ) : null}
          {body ? (
            <pre style={{ ...trafficPreStyle, marginTop: headerText ? 6 : 0 }}>{body}</pre>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>{t('（空）')}</div>
          )}
          <Button
            size='touch-sm'
            variant='outline'
            type='button'
            className='m-btn m-sm m-ghost w-full'
            style={{ height: 30, fontSize: 11.5, marginTop: 8 }}
            onClick={onCopy}
          >
            {copied ? t('已复制') : t('复制这一段')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const trafficPreStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  maxHeight: 220,
  overflow: 'auto',
  background: 'var(--m-surface-2)',
  borderRadius: 8,
  fontFamily: 'var(--m-mono)',
  fontSize: 11,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  color: 'var(--m-text-2)',
}

function formatHeaders(headers?: Record<string, string> | string): string {
  if (!headers) return ''
  if (typeof headers === 'string') return headers
  return Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')
}
