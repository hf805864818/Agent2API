import { useCallback, useEffect, useRef, useState } from 'react'
import { PageIntro, IconButton, ErrorNote, SkeletonList, Badge, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { PullIndicator, usePullToRefresh } from '../components/PullToRefresh'
import { store } from '../state/store'
import {
  checkUpdate,
  fetchImageCompress,
  fetchPanelStatus,
  fetchModelsDev,
  fetchRetention,
  fetchStorage,
  fetchSystemInfo,
  refreshModelsDev,
  saveImageCompress,
  saveModelsDev,
  saveRetention,
  type ImageCompressSettings,
  type PanelStatus,
  type UpdateCheck,
  type ModelsDevStatus,
  type RetentionSettings,
  type StorageOverview,
  type SystemInfo,
} from '../api/gateway-settings'
import { formatBytes, formatStamp } from '../lib/format'
import { t } from '../i18n'
import { Button, Card, Input, Switch as UiSwitch } from '@ui'

/**
 * 系统与数据（桌面端 设置 → 数据 / 版本信息 的安卓版）。
 *
 * 五块内容，全部只读或「少数几个数字 + 一个开关」：
 *
 *   数据保留  /api/retention        五个天数/条数
 *   存储概况  /api/storage          库文件、体积、各表条数
 *   图片压缩  /api/image-compress   开关 + 长边 / 质量 / 阈值
 *   models.dev /api/models/metadata 开关 + 来源 / 时间 / 条数 + 手动刷新
 *   版本信息  /api/system-info      版本 / schema / 平台 / 部署形态 / 启动时间
 *
 * 为什么手机上也值得放：这台网关跑在别处，用户手里只有手机。想知道「日志
 * 存多久、库多大、是不是 Docker」时，不该为了看一眼去开电脑。
 *
 * 两处取舍：
 *   · 保留期、图片压缩各有自己的保存按钮 —— 两个独立端点，合并只让「哪组
 *     没存上」更难查；
 *   · 存储与版本信息不做任何写操作，纯展示（清理数据、重置管理员这类破坏
 *     性动作留在桌面端）。
 */

type NumberDraft = Record<string, string>

const RETENTION_FIELDS: Array<{ key: keyof RetentionSettings; label: string; unit: string; hint: string }> = [
  { key: 'logRetentionDays', label: t('运行日志保留天数'), unit: t('天'), hint: t('超过天数的系统事件会被清理') },
  { key: 'logRetentionCount', label: t('运行日志保留条数'), unit: t('条'), hint: t('按条数上限再收一道，0 = 不限') },
  { key: 'requestLogRetentionDays', label: t('请求日志保留天数'), unit: t('天'), hint: t('请求明细（含模型、账号、token）') },
  { key: 'requestLogRetentionCount', label: t('请求日志保留条数'), unit: t('条'), hint: t('0 = 不限') },
  { key: 'dailyAggregateRetentionDays', label: t('日聚合保留天数'), unit: t('天'), hint: t('报表用的按天汇总，保留久一点不影响体积') },
]

const COMPRESS_NUMBERS: Array<{ key: keyof ImageCompressSettings; label: string; unit: string; hint: string }> = [
  { key: 'imageCompressMaxEdge', label: t('长边像素上限'), unit: t('px'), hint: t('2048 一般够用，调小更省流量但细节会丢') },
  { key: 'imageCompressQuality', label: t('重编码质量'), unit: '', hint: t('40–95，越小体积越小、画质越差') },
  { key: 'imageCompressThresholdKb', label: t('触发阈值'), unit: t('KB'), hint: t('小于这个体积的图保持原样；0 = 全部压一遍') },
]

export function SystemPage() {
  const [retention, setRetention] = useState<RetentionSettings | null>(null)
  const [retentionDraft, setRetentionDraft] = useState<NumberDraft | null>(null)
  const [storage, setStorage] = useState<StorageOverview | null>(null)
  const [compress, setCompress] = useState<ImageCompressSettings | null>(null)
  const [compressDraft, setCompressDraft] = useState<{ enabled: boolean; numbers: NumberDraft } | null>(null)
  const [modelsDev, setModelsDev] = useState<ModelsDevStatus | null>(null)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [panel, setPanel] = useState<PanelStatus | null>(null)
  const [updateResult, setUpdateResult] = useState<UpdateCheck | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const seq = useRef(0)
  const retentionBase = useRef('')
  const compressBase = useRef('')

  const adoptRetention = useCallback((next: RetentionSettings) => {
    setRetention(next)
    const draft = toDraft(next as unknown as Record<string, unknown>, RETENTION_FIELDS.map(f => f.key as string))
    setRetentionDraft(draft)
    retentionBase.current = JSON.stringify(draft)
  }, [])

  const adoptCompress = useCallback((next: ImageCompressSettings) => {
    setCompress(next)
    const numbers = toDraft(next as unknown as Record<string, unknown>, COMPRESS_NUMBERS.map(f => f.key as string))
    setCompressDraft({ enabled: Boolean(next.imageCompressEnabled), numbers })
    compressBase.current = JSON.stringify({ enabled: Boolean(next.imageCompressEnabled), numbers })
  }, [])

  const load = useCallback(async (silent = false) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const [retentionNext, storageNext, compressNext, modelsDevNext, infoNext, panelNext] = await Promise.all([
        fetchRetention(),
        fetchStorage(),
        fetchImageCompress(),
        fetchModelsDev(),
        fetchSystemInfo(),
        fetchPanelStatus(),
      ])
      if (id !== seq.current) return
      if (!retentionNext || !compressNext) throw new Error(t('系统信息接口返回了不完整的数据'))
      adoptRetention(retentionNext)
      adoptCompress(compressNext)
      setStorage(storageNext)
      setModelsDev(modelsDevNext)
      setInfo(infoNext)
      setPanel(panelNext)
      setError('')
    } catch (failure) {
      if (id === seq.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [adoptRetention, adoptCompress])

  useEffect(() => {
    void load()
    return () => { seq.current++ }
  }, [load])

  const pull = usePullToRefresh({ onRefresh: () => load(true) })

  const retentionDirty = retentionDraft ? JSON.stringify(retentionDraft) !== retentionBase.current : false
  const compressDirty = compressDraft
    ? JSON.stringify({ enabled: compressDraft.enabled, numbers: compressDraft.numbers }) !== compressBase.current
    : false

  const saveRetentionDraft = async () => {
    if (!retentionDraft) return
    const patch: Record<string, number> = {}
    for (const field of RETENTION_FIELDS) {
      const raw = (retentionDraft[field.key as string] ?? '').trim()
      const value = Number(raw)
      if (!raw || !Number.isInteger(value) || value < 0) {
        store.toast(t('「{name}」必须是非负整数', { name: field.label }), 'err')
        return
      }
      patch[field.key as string] = value
    }
    setBusy('retention')
    try {
      adoptRetention(await saveRetention(patch as Partial<RetentionSettings>))
      store.toast(t('已保存数据保留设置'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const saveCompressDraft = async () => {
    if (!compressDraft) return
    const patch: Record<string, number | boolean> = { imageCompressEnabled: compressDraft.enabled }
    for (const field of COMPRESS_NUMBERS) {
      const raw = (compressDraft.numbers[field.key as string] ?? '').trim()
      const value = Number(raw)
      if (!raw || !Number.isInteger(value) || value < 0) {
        store.toast(t('「{name}」必须是非负整数', { name: field.label }), 'err')
        return
      }
      patch[field.key as string] = value
    }
    setBusy('compress')
    try {
      adoptCompress(await saveImageCompress(patch as Partial<ImageCompressSettings>))
      store.toast(t('已保存图片压缩设置'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const toggleModelsDev = async (next: boolean) => {
    setModelsDev(current => (current ? { ...current, modelsDevEnabled: next } : current))
    setBusy('modelsdev')
    try {
      const result = await saveModelsDev(next)
      if (result) setModelsDev(result)
      store.toast(next ? t('已开启 models.dev 补充') : t('已关闭 models.dev 补充'))
    } catch (failure) {
      setModelsDev(current => (current ? { ...current, modelsDevEnabled: !next } : current))
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const doRefreshModelsDev = async () => {
    setBusy('refresh')
    try {
      await refreshModelsDev()
      await load(true)
      store.toast(t('已触发 models.dev 刷新'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const doCheckUpdate = async () => {
    setBusy('update')
    try {
      const next = await checkUpdate(info?.app?.version || '')
      setUpdateResult(next)
      const latest = String(next?.latest ?? next?.version ?? '')
      if (latest) store.toast(t('最新版本：{v}', { v: latest }))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const db = storage?.database

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageIntro
        subtitle={t('数据保留 · 存储 · 图片压缩 · 版本')}
        actions={<IconButton name='refresh' label={t('刷新')} onClick={() => void load(true)} />}
      />

      {error ? <ErrorNote text={error} /> : null}
      {loading && !retention ? <SkeletonList rows={4} height={70} /> : null}

      {/* ── 数据保留 ─────────────────────────────────────────── */}
      {retentionDraft ? (
        <div className='m-section' style={{ marginTop: 0 }}>
          <SectionHead title={t('数据保留')} />
          <Card className='m-card m-card-pad'>
            {RETENTION_FIELDS.map(field => (
              <NumberRow
                key={field.key as string}
                label={field.label}
                unit={field.unit}
                hint={field.hint}
                value={retentionDraft[field.key as string] ?? ''}
                onChange={next => setRetentionDraft(current => ({ ...current!, [field.key as string]: next }))}
              />
            ))}
            <Button
              size='touch'
              variant='default'
              className='m-btn w-full'
              style={{ marginTop: 10 }}
              disabled={busy === 'retention' || !retentionDirty}
              onClick={() => void saveRetentionDraft()}
            >
              {busy === 'retention' ? t('正在保存…') : retentionDirty ? t('保存保留设置') : t('当前设置已保存')}
            </Button>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('清理在网关侧按天执行；改小会立刻影响下一次清理，改大不会恢复已删的记录。')}
            </div>
          </Card>
        </div>
      ) : null}

      {/* ── 存储概况 ─────────────────────────────────────────── */}
      {storage ? (
        <div className='m-section'>
          <SectionHead title={t('存储概况')} />
          <Card className='m-card'>
            <InfoRow label={t('数据库文件')} value={db?.file || storage.configDir || '—'} mono />
            <InfoRow label={t('库体积')} value={db?.available === false ? t('暂不可用') : formatBytes(Number(db?.bytes) || 0)} />
            <InfoRow label={t('账号')} value={String(db?.accounts ?? '—')} />
            <InfoRow label={t('系统事件')} value={String(db?.logs ?? '—')} />
            <InfoRow label={t('请求记录')} value={String(db?.requests ?? '—')} />
            <InfoRow label={t('日聚合')} value={t('{n} 天', { n: db?.dailyDays ?? 0 })} />
            <InfoRow label={t('调试报文')} value={String(db?.debug ?? '—')} last />
          </Card>
        </div>
      ) : null}

      {/* ── 图片压缩 ─────────────────────────────────────────── */}
      {compressDraft && compress ? (
        <div className='m-section'>
          <SectionHead title={t('图片压缩')} />
          <Card className='m-card m-card-pad'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 550 }}>{t('转发前压缩对话里的大图')}</div>
                <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 3, lineHeight: 1.5 }}>
                  {t('只改发给上游的副本，客户端看到的原图不受影响')}
                </div>
              </div>
              <UiSwitch
                size='touch'
                variant='success'
                checked={compressDraft.enabled}
                aria-label={t('图片压缩')}
                onCheckedChange={next => setCompressDraft(current => (current ? { ...current, enabled: next } : current))}
              />
            </div>
            {COMPRESS_NUMBERS.map(field => (
              <NumberRow
                key={field.key as string}
                label={field.label}
                unit={field.unit}
                hint={field.hint}
                value={compressDraft.numbers[field.key as string] ?? ''}
                onChange={next => setCompressDraft(current => ({
                  ...current!,
                  numbers: { ...current!.numbers, [field.key as string]: next },
                }))}
              />
            ))}
            <Button
              size='touch'
              variant='default'
              className='m-btn w-full'
              style={{ marginTop: 10 }}
              disabled={busy === 'compress' || !compressDirty}
              onClick={() => void saveCompressDraft()}
            >
              {busy === 'compress' ? t('正在保存…') : compressDirty ? t('保存压缩设置') : t('当前设置已保存')}
            </Button>
          </Card>
        </div>
      ) : null}

      {/* ── models.dev ───────────────────────────────────────── */}
      {modelsDev ? (
        <div className="m-section">
          <SectionHead title={t('models.dev 模型元数据')} />
          <Card className='m-card m-card-pad'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 550 }}>{t('用 models.dev 补上游没声明的能力')}</div>
                <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 3, lineHeight: 1.5 }}>
                  {t('只影响模型能力的来源标记与思考档位，不改转发行为')}
                </div>
              </div>
              <UiSwitch
                size='touch'
                variant='success'
                checked={Boolean(modelsDev.modelsDevEnabled)}
                aria-label={t('models.dev')}
                disabled={busy === 'modelsdev'}
                onCheckedChange={next => void toggleModelsDev(next)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {typeof modelsDev.count === 'number' ? <Badge tone='mute'>{t('{n} 条', { n: modelsDev.count })}</Badge> : null}
              {modelsDev.source ? <Badge tone='mute'>{t('来源：{v}', { v: String(modelsDev.source) })}</Badge> : null}
              {modelsDev.updatedAt ? (
                <Badge tone='mute'>{t('更新于 {v}', { v: formatStamp(Number(modelsDev.updatedAt)) })}</Badge>
              ) : null}
            </div>
            <Button
              size='touch'
              variant='outline'
              className='m-btn m-ghost w-full'
              style={{ marginTop: 10 }}
              disabled={busy === 'refresh'}
              onClick={() => void doRefreshModelsDev()}
            >
              <Icon name='refresh' style={{ width: 14, height: 14 }} />
              {busy === 'refresh' ? t('正在刷新…') : t('立即刷新元数据')}
            </Button>
          </Card>
        </div>
      ) : null}

      {/* ── 安全 ─────────────────────────────────────────────── */}
      {panel ? (
        <div className='m-section'>
          <SectionHead title={t('安全')} />
          <Card className='m-card'>
            <InfoRow
              label={t('管理员账号')}
              value={panel.registered ? t('已注册') : t('未注册')}
            />
            <InfoRow
              label={t('面板登录')}
              value={panel.registered ? t('需要管理员账号') : t('管理窗口免登录（仅本机）')}
              last
            />
          </Card>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', padding: '0 2px', lineHeight: 1.6 }}>
            {t('注册管理员、开启机器人校验、重置密码都在桌面面板「设置 → 安全」里；手机端只做状态核对。')}
          </div>
        </div>
      ) : null}

      {/* ── 更新 ─────────────────────────────────────────────── */}
      <div className='m-section'>
        <SectionHead title={t('更新')} />
        <Card className='m-card m-card-pad'>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 550 }}>{t('检查网关更新')}</div>
              <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 3, lineHeight: 1.5 }}>
                {t('当前 {v} · 通道 {c}', {
                  v: info?.app?.version || '—',
                  c: info?.app?.channel || '—',
                })}
              </div>
            </div>
            <Button
              size='touch-sm'
              variant='outline'
              type='button'
              className='m-btn m-sm m-ghost'
              disabled={busy === 'update'}
              onClick={() => void doCheckUpdate()}
              style={{ height: 30, fontSize: 11.5, padding: '0 12px' }}
            >
              {busy === 'update' ? t('检查中…') : t('检查更新')}
            </Button>
          </div>
          {updateResult ? (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge tone={updateResult.hasUpdate || updateResult.available ? 'warn' : 'ok'}>
                {updateResult.hasUpdate || updateResult.available ? t('有新版本') : t('已是最新')}
              </Badge>
              {updateResult.latest || updateResult.version ? (
                <Badge tone='mute'>{t('最新 {v}', { v: String(updateResult.latest ?? updateResult.version) })}</Badge>
              ) : null}
              {updateResult.channel ? <Badge tone='mute'>{String(updateResult.channel)}</Badge> : null}
            </div>
          ) : null}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
            {t('升级要替换网关进程，只能在桌面端 / 服务器命令行执行；手机端只负责告诉你有没有新版。')}
          </div>
        </Card>
      </div>

      {/* ── 版本信息 ─────────────────────────────────────────── */}
      {info ? (
        <div className='m-section'>
          <SectionHead title={t('版本信息')} />
          <Card className='m-card'>
            <InfoRow label={t('网关版本')} value={info.app?.version || '—'} mono />
            <InfoRow label={t('更新通道')} value={info.app?.channel || '—'} />
            <InfoRow label={t('数据结构版本')} value={String(info.app?.dbSchemaVersion ?? info.app?.schemaVersion ?? '—')} />
            <InfoRow label={t('运行平台')} value={`${info.runtime?.os || '—'} ${info.runtime?.osVersion || ''}`.trim()} />
            <InfoRow label={t('架构')} value={info.runtime?.arch || '—'} mono />
            <InfoRow
              label={t('部署形态')}
              value={[
                info.runtime?.deployment || '—',
                info.runtime?.container === true ? t('容器内') : info.runtime?.container === false ? t('裸机') : '',
              ].filter(Boolean).join(' · ')}
            />
            <InfoRow label={t('启动时间')} value={info.runtime?.startedAt ? formatStamp(Number(info.runtime.startedAt)) : '—'} />
            <InfoRow label={t('许可')} value={info.app?.license || '—'} last />
          </Card>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--m-text-3)', padding: '0 2px', lineHeight: 1.6 }}>
            {t('网关的升级在桌面端 / 服务器命令行执行；手机端只做版本核对。')}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ── 小组件 ───────────────────────────────────────────────── */

function NumberRow({ label, value, unit, hint, onChange }: {
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
        {hint ? <div style={{ fontSize: 10.5, color: 'var(--m-text-3)', marginTop: 2, lineHeight: 1.5 }}>{hint}</div> : null}
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

function InfoRow({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '10px 14px',
        borderBottom: last ? 'none' : '1px solid var(--m-line)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--m-text-3)', flex: 'none' }}>{label}</span>
      <span
        className={mono ? 'm-mono' : undefined}
        style={{
          fontSize: 12.5,
          marginLeft: 'auto',
          textAlign: 'right',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function toDraft(source: Record<string, unknown>, keys: string[]): NumberDraft {
  const draft: NumberDraft = {}
  for (const key of keys) {
    const value = source?.[key]
    draft[key] = typeof value === 'number' ? String(value) : ''
  }
  return draft
}
