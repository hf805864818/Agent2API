import { useCallback, useEffect, useRef, useState } from 'react'
import { PageIntro, IconButton, ErrorNote, SkeletonList, Badge, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { PullIndicator, usePullToRefresh } from '../components/PullToRefresh'
import { store } from '../state/store'
import {
  cloudSyncDownload,
  cloudSyncTest,
  cloudSyncUpload,
  fetchActivityBanner,
  fetchCheckinStatus,
  fetchCloudSync,
  fetchUsage,
  type CheckinStatus,
  type CloudSyncView,
  type UsageSummary,
} from '../api/gateway-settings'
import { formatStamp } from '../lib/format'
import { formatCompact } from '../lib/format'
import { t } from '../i18n'
import { Button, Card, confirmDialog } from '@ui'

/**
 * 额度与同步（更多 → 额度与同步）。
 *
 * 把三个「看一眼状态 / 偶尔点一下」的桌面分组收到一页：
 *
 *   用量汇总  GET /api/usage                上游返回的动态结构，按已知字段容错渲染
 *   签到状态  GET /api/checkin/status       今日签到 / 活动进度
 *   云同步    GET /api/cloud-sync           状态 + 测试 / 上传 / 下载
 *
 * 为什么手机端只做只读 + 触发：
 *   · 用量与额度来自上游，字段随供应商变化，硬编码成表单只会显示错；
 *   · 云同步的配置（WebDAV/S3 密钥、同步密码）属于敏感项，桌面端填一次即可，
 *     手机上重复填既增加泄露面又没有收益 —— 所以这里只显示「配没配、同步到
 *     哪个路径、上次什么时候成功」，并能手动触发一次同步或做连通性测试。
 */

export function CreditsPage() {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [checkin, setCheckin] = useState<CheckinStatus>(null)
  const [banner, setBanner] = useState<unknown>(null)
  const [cloud, setCloud] = useState<CloudSyncView | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const seq = useRef(0)

  const load = useCallback(async (silent = false) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const [usageNext, checkinNext, bannerNext, cloudNext] = await Promise.allSettled([
        fetchUsage(),
        fetchCheckinStatus(),
        fetchActivityBanner(),
        fetchCloudSync(),
      ])
      if (id !== seq.current) return
      setUsage(usageNext.status === 'fulfilled' ? usageNext.value : null)
      setCheckin(checkinNext.status === 'fulfilled' ? checkinNext.value : null)
      setBanner(bannerNext.status === 'fulfilled' ? bannerNext.value : null)
      setCloud(cloudNext.status === 'fulfilled' ? cloudNext.value : null)
      setError('')
    } catch (failure) {
      if (id === seq.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => { seq.current++ }
  }, [load])

  const pull = usePullToRefresh({ onRefresh: () => load(true) })

  const act = async (key: string, label: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText) {
      const ok = await confirmDialog(confirmText, { title: label, confirmText: label })
      if (!ok) return
    }
    setBusy(key)
    try {
      const result = await fn()
      const message = typeof result === 'object' && result && 'message' in result
        ? String((result as { message?: unknown }).message ?? label)
        : label
      store.toast(message)
      await load(true)
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const bannerText = readBannerText(banner)
  const checkinRows = flattenStatus(checkin)
  const usageRows = flattenUsage(usage)

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageIntro
        subtitle={t('用量 · 签到 · 云同步')}
        actions={<IconButton name='refresh' label={t('刷新')} onClick={() => void load(true)} />}
      />

      {error ? <ErrorNote text={error} /> : null}
      {loading && !usage ? <SkeletonList rows={4} height={70} /> : null}

      {/* ── 用量汇总 ─────────────────────────────────────────── */}
      <div className='m-section' style={{ marginTop: 0 }}>
        <SectionHead title={t('用量与额度')} />
        <Card className='m-card'>
          {usageRows.length ? usageRows.map((row, index) => (
            <div key={`${row.label}-${index}`} style={{
              display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 14px',
              borderBottom: index === usageRows.length - 1 ? 'none' : '1px solid var(--m-line)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--m-text-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.label}
              </span>
              <span className='m-mono' style={{ fontSize: 13, marginLeft: 'auto', flex: 'none', textAlign: 'right' }}>{row.value}</span>
            </div>
          )) : (
            <div style={{ padding: 18, fontSize: 12, color: 'var(--m-text-3)', textAlign: 'center', lineHeight: 1.6 }}>
              {t('上游没返回额度数据；按量计费的供应商通常才有，订阅类账号可以不管。')}
            </div>
          )}
        </Card>
      </div>

      {/* ── 签到与活动 ───────────────────────────────────────── */}
      <div className='m-section'>
        <SectionHead title={t('签到与活动')} />
        <Card className='m-card m-card-pad'>
          {bannerText ? (
            <div style={{
              fontSize: 12, color: 'var(--m-text-2)', lineHeight: 1.7,
              padding: '9px 11px', background: 'var(--m-surface-2)', borderRadius: 10, marginBottom: 10,
            }}>
              {bannerText}
            </div>
          ) : null}
          {checkinRows.length ? checkinRows.map((row, index) => (
            <div key={`${row.label}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={{ fontSize: 12.5, color: 'var(--m-text-2)', flex: 1 }}>{row.label}</span>
              <span style={{ fontSize: 12.5 }}>{row.value}</span>
            </div>
          )) : (
            <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('当前没有进行中的签到活动。')}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
            {t('签到操作在「更多 → 签到中心」里执行，这里只看额度与活动状态。')}
          </div>
        </Card>
      </div>

      {/* ── 云同步 ───────────────────────────────────────────── */}
      {cloud ? (
        <div className='m-section'>
          <SectionHead title={t('云同步')} />
          <Card className='m-card m-card-pad'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge tone={cloud.enabled ? 'ok' : 'mute'}>
                {cloud.enabled ? t('已启用') : t('未启用')}
              </Badge>
              {cloud.autoSync ? <Badge tone='mute'>{t('自动同步')}</Badge> : null}
              <Badge tone='mute'>{cloud.provider === 's3' ? 'S3' : 'WebDAV'}</Badge>
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <InfoLine label={t('远端路径')} value={cloud.remotePath || cloud.remoteRoot || '—'} />
              <InfoLine
                label={t('上次同步')}
                value={cloud.status?.lastSyncAt ? formatStamp(Number(cloud.status.lastSyncAt)) : t('从未同步')}
              />
              {cloud.status?.lastAction ? <InfoLine label={t('上次动作')} value={String(cloud.status.lastAction)} /> : null}
              {cloud.status?.lastError ? (
                <div style={{ fontSize: 11.5, color: 'var(--m-danger)', lineHeight: 1.6 }}>
                  {t('上次失败：{v}', { v: cloud.status.lastError })}
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <Button size='touch-sm' variant='outline' className='m-btn m-sm m-ghost' disabled={Boolean(busy)}
                onClick={() => void act('test', t('测试连通性'), cloudSyncTest)}>
                {busy === 'test' ? t('测试中…') : t('测试连通性')}
              </Button>
              <Button size='touch-sm' variant='outline' className='m-btn m-sm m-ghost' disabled={Boolean(busy)}
                onClick={() => void act('upload', t('上传到云端'), cloudSyncUpload, t('会用本机当前快照覆盖远端同名文件，确定继续？'))}>
                {busy === 'upload' ? t('上传中…') : t('上传')}
              </Button>
              <Button size='touch-sm' variant='outline' className='m-btn m-sm m-ghost' disabled={Boolean(busy)}
                onClick={() => void act('download', t('从云端恢复'), cloudSyncDownload, t('会用远端快照覆盖本机配置，确定继续？'))}>
                {busy === 'download' ? t('下载中…') : t('下载')}
              </Button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('WebDAV / S3 地址与密钥在桌面端「设置 → 云同步」里配置；手机端只做触发与状态核对。')}
            </div>
          </Card>
        </div>
      ) : null}

      <div className='m-section' style={{ paddingBottom: 8 }}>
        <Card className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
          {t('用量与签到状态由网关实时读取上游；云同步的上传 / 下载在网关侧执行，手机只是发起指令。')}
        </Card>
      </div>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 12 }}>
      <span style={{ color: 'var(--m-text-3)', flex: 'none' }}>{label}</span>
      <span className='m-mono' style={{ marginLeft: 'auto', textAlign: 'right', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>{value}</span>
    </div>
  )
}

/* ── 动态结构的容错展开 ─────────────────────────────────────── */

const USAGE_LABELS: Record<string, string> = {
  total: '总额度', used: '已用', remaining: '剩余', balance: '余额',
  tokens: 'Token', requests: '请求数', credits: '积分', points: '点数',
  today: '今日', todayTokens: '今日 Token', todayRequests: '今日请求',
  currency: '币种', plan: '套餐', expiresAt: '到期',
}

function flattenUsage(usage: UsageSummary | null): Array<{ label: string; value: string }> {
  if (!usage || typeof usage !== 'object') return []
  const rows: Array<{ label: string; value: string }> = []
  const walk = (value: unknown, prefix = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(item) || (item && typeof item === 'object')) {
        walk(item, prefix ? `${prefix}.${key}` : key)
        continue
      }
      if (item === null || item === undefined || item === '') continue
      const full = prefix ? `${prefix}.${key}` : key
      // 只收数字与短枚举，长文本（消息 / 错误）不塞进概览
      if (typeof item === 'number' || typeof item === 'boolean' || (typeof item === 'string' && item.length <= 24)) {
        const tail = key
        rows.push({ label: USAGE_LABELS[tail] || USAGE_LABELS[key] || full, value: typeof item === 'number' ? formatCompact(item) : String(item) })
      }
    }
  }
  walk(usage)
  // 上游可能把真正的数据包在 data / summary 里，展开后按前缀去重保前 14 行
  const seen = new Set<string>()
  return rows.filter(row => {
    if (seen.has(row.label)) return false
    seen.add(row.label)
    return true
  }).slice(0, 14)
}

function flattenStatus(status: CheckinStatus): Array<{ label: string; value: string }> {
  if (!status || typeof status !== 'object') return []
  const rows: Array<{ label: string; value: string }> = []
  for (const [key, item] of Object.entries(status)) {
    if (item === null || item === undefined || (typeof item === 'object' && !Array.isArray(item))) continue
    const value = typeof item === 'number' ? formatCompact(item) : Array.isArray(item) ? String(item.length) : String(item)
    if (value.length > 40) continue
    rows.push({ label: key, value })
  }
  return rows.slice(0, 10)
}

function readBannerText(banner: unknown): string {
  if (!banner || typeof banner !== 'object') return ''
  const obj = banner as Record<string, unknown>
  for (const key of ['title', 'text', 'message', 'content', 'description']) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}
