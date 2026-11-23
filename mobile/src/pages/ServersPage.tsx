import { useState } from 'react'
import { Icon } from '../components/Icon'
import { PageHead, PageIntro, SectionHead, ErrorNote } from '../components/ui'
import { store, useStore } from '../state/store'
import { probe } from '../api/client'
import { baseLabel, joinHostPort, normalizeBase, splitBase, DEFAULT_GATEWAY_PORT } from '../lib/servers'
import { t } from '../i18n'
import { Button, Card, Label, Input } from '@ui'
import { Badge } from '@ui'

/**
 * 服务器配置（仅 APK）。
 *
 * ── 为什么单独一屏而不是塞进设置页 ────────────────────────────
 * 首次启动时还没有任何服务器，所有页面都拿不到数据 —— 这时设置页本身也
 * 是空的。所以它必须是**前置**的一屏：没配置就进不去主界面。
 *
 * ── 为什么先探活再保存 ────────────────────────────────────────
 * 地址填错（少写端口、多写 `/m`、网关没开局域网访问）是最高频的失败。
 * 保存前打一次 `/health`，把「连不上」当场说清楚，比存进去之后每个页面
 * 各报一次错要好得多。探活成功顺带显示网关版本，用户能确认连的是对的那台。
 */
export function ServersPage() {
  const { servers, server, stack } = useStore()
  /** 压栈进来（登录层的「换一台服务器」）而不是首次启动时的整屏 */
  const stacked = stack.length > 0
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftHost, setDraftHost] = useState('')
  const [draftPort, setDraftPort] = useState(String(DEFAULT_GATEWAY_PORT))
  const [draftHttps, setDraftHttps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [probed, setProbed] = useState<{ version?: string } | null>(null)

  const startAdd = () => {
    setEditing('new')
    setDraftName('')
    setDraftHost('')
    setDraftPort(String(DEFAULT_GATEWAY_PORT))
    setDraftHttps(false)
    setError('')
    setProbed(null)
  }

  const startEdit = (id: string) => {
    const entry = servers.find(item => item.id === id)
    if (!entry) return
    setEditing(id)
    const parts = splitBase(entry.base)
    setDraftName(entry.name)
    setDraftHost(parts.host)
    setDraftPort(parts.port)
    setDraftHttps(parts.https)
    setError('')
    setProbed(null)
  }

  const cancel = () => {
    setEditing(null)
    setError('')
    setProbed(null)
  }

  const save = async () => {
    const portText = draftPort.trim()
    if (portText && (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535)) {
      setError(t('端口要是 1 ~ 65535 之间的数字'))
      return
    }
    const base = joinHostPort(draftHost, portText, draftHttps)
    if (!base) {
      setError(t('主机地址填不对。填电脑在局域网里的 IP 或域名，例如 192.168.1.23'))
      return
    }
    setBusy(true)
    setError('')
    const result = await probe(base)
    setBusy(false)
    if (!result.ok) {
      setError(t('连不上这台网关。确认地址与端口正确、网关已启动，且已开启「局域网访问」；用 https 时还要确认证书有效'))
      return
    }
    setProbed({ version: result.version })
    if (editing === 'new') {
      store.addServer({ name: draftName, base })
    } else if (editing) {
      store.updateServer(editing, { name: draftName, base })
    }
    setEditing(null)
    setProbed(null)
    store.toast(t('已保存'))
    // 换到新服务器后立刻拉一次会话；没登录会弹登录层
    void store.refresh(true).then(() => {
      // 这一屏是从登录层的「换一台服务器」压进来的：保存完退回原页，
      // 登录层（需要的话）会重新盖上来，用户不会卡在服务器列表里
      if (store.get().stack.length > 0) store.back()
    })
  }

  return (
    <div className='m-page'>
      {/* 作为二级页压栈进来时顶部已有返回栏，标题不再重复一遍 */}
      {stacked ? (
        <PageIntro
          subtitle={servers.length ? t('已添加 {n} 台', { n: servers.length }) : t('先添加一台网关')}
          actions={
            <Button size='touch-sm' variant='default' type='button' className='m-btn m-sm' onClick={startAdd} disabled={editing === 'new'}>
              <Icon name='plus' />
              {t('添加')}
            </Button>
          }
        />
      ) : (
        <PageHead
          title={t('服务器')}
          subtitle={servers.length ? t('已添加 {n} 台', { n: servers.length }) : t('先添加一台网关')}
          actions={
            <Button size='touch-sm' variant='default' type='button' className='m-btn m-sm' onClick={startAdd} disabled={editing === 'new'}>
              <Icon name='plus' />
              {t('添加')}
            </Button>
          }
        />
      )}

      {error ? <ErrorNote text={error} /> : null}

      {/* 编辑表单：新增与修改共用 */}
      {editing ? (
        <div className='m-section' style={{ marginTop: 0 }}>
          <Card className='m-card m-card-pad'>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {editing === 'new' ? t('添加服务器') : t('编辑服务器')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--m-text-3)', marginTop: 12 }}>{t('主机')}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
              <Input
                value={draftHost}
                onChange={event => setDraftHost(event.target.value)}
                placeholder={t('192.168.1.23 或 gw.example.com')}
                inputMode='url'
                autoCapitalize='off'
                autoCorrect='off'
                spellCheck={false}
                style={{
                  flex: 1,
                  minWidth: 0,
                  boxSizing: 'border-box',
                  height: 44,
                  padding: '0 12px',
                  borderRadius: 11,
                  border: '1px solid var(--m-line-strong)',
                  background: 'var(--m-surface-2)',
                  color: 'var(--m-text)',
                  fontSize: 16,
                  fontFamily: 'var(--m-mono)',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 44, borderRadius: 11, border: '1px solid var(--m-line-strong)', background: 'var(--m-surface-2)' }}>
                <button
                  type='button'
                  aria-pressed={!draftHttps}
                  onClick={() => setDraftHttps(false)}
                  style={{ border: 0, background: 'none', padding: 0, fontSize: 12.5, fontWeight: draftHttps ? 400 : 600, color: draftHttps ? 'var(--m-text-3)' : 'var(--m-primary)' }}
                >
                  http
                </button>
                <span style={{ fontSize: 11, color: 'var(--m-text-3)' }}>/</span>
                <button
                  type='button'
                  aria-pressed={draftHttps}
                  onClick={() => { setDraftHttps(true); if (draftPort === String(DEFAULT_GATEWAY_PORT)) setDraftPort('443') }}
                  style={{ border: 0, background: 'none', padding: 0, fontSize: 12.5, fontWeight: draftHttps ? 600 : 400, color: draftHttps ? 'var(--m-primary)' : 'var(--m-text-3)' }}
                >
                  https
                </button>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--m-text-3)', marginTop: 12 }}>{t('端口')}</div>
            <Input
              value={draftPort}
              onChange={event => setDraftPort(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder={String(DEFAULT_GATEWAY_PORT)}
              inputMode='numeric'
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginTop: 5,
                height: 44,
                padding: '0 12px',
                borderRadius: 11,
                border: '1px solid var(--m-line-strong)',
                background: 'var(--m-surface-2)',
                color: 'var(--m-text)',
                fontSize: 16,
                fontFamily: 'var(--m-mono)',
              }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {[
                { port: String(DEFAULT_GATEWAY_PORT), label: t('网关默认') },
                { port: '8080', label: '8080' },
                { port: '8081', label: '8081' },
                { port: '8443', label: '8443' },
                { port: '443', label: '443' },
                { port: '18789', label: '18789' },
              ].map(item => {
                const active = draftPort === item.port
                return (
                  <button
                    key={item.port}
                    type='button'
                    aria-pressed={active}
                    onClick={() => setDraftPort(item.port)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 999,
                      fontSize: 11.5,
                      border: `1px solid ${active ? 'var(--m-primary)' : 'var(--m-line)'}`,
                      background: active ? 'var(--m-primary-soft)' : 'transparent',
                      color: active ? 'var(--m-primary)' : 'var(--m-text-2)',
                    }}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 8, lineHeight: 1.6 }}>
              {t('主机填电脑在局域网里的 IP，端口填网关实际监听的端口。地址里的 /m、/v1 会自动去掉。')}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 4, lineHeight: 1.6 }}>
              {t('网关默认端口 {port}。若在电脑上改过端口，或走反向代理/内网穿透，就填那个端口。', { port: String(DEFAULT_GATEWAY_PORT) })}
            </div>
            <Label style={{ display: 'block', marginTop: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--m-text-3)' }}>{t('备注名（可选）')}</span>
              <Input
                value={draftName}
                onChange={event => setDraftName(event.target.value)}
                placeholder={t('例如：家里、公司')}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 5,
                  height: 44,
                  padding: '0 12px',
                  borderRadius: 11,
                  border: '1px solid var(--m-line-strong)',
                  background: 'var(--m-surface-2)',
                  color: 'var(--m-text)',
                  fontSize: 16,
                }}
              />
            </Label>
            <div className='m-btn-row' style={{ marginTop: 14 }}>
              <Button size='touch' variant='outline' type='button' className='m-btn m-ghost' style={{ flex: 1 }} onClick={cancel} disabled={busy}>
                {t('取消')}
              </Button>
              <Button size='touch' variant='default' type='button' className='m-btn' style={{ flex: 1 }} onClick={() => void save()} disabled={busy || !draftHost.trim()}>
                {busy ? t('正在连接…') : t('连接并保存')}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <div className='m-section'>
        <SectionHead title={t('已添加的服务器')} />
        {servers.length === 0 ? (
          <Card className='m-card m-card-pad' style={{ fontSize: 12.5, color: 'var(--m-text-2)', lineHeight: 1.7 }}>
            {t('还没有添加服务器。点右上角「添加」，填入网关所在机器的 IP 或域名与端口。')}
          </Card>
        ) : (
          <Card className='m-card'>
            {servers.map(entry => {
              const current = server?.id === entry.id
              return (
                <div key={entry.id} className='m-row'>
                  <span
                    className='m-logo'
                    style={
                      current
                        ? { background: 'var(--m-primary-soft)', borderColor: 'transparent', color: 'var(--m-primary)' }
                        : undefined
                    }
                  >
                    <Icon name='server' />
                  </span>
                  <Button size='default' variant='ghost'
                    type='button'
                    className='m-grow'
                    onClick={() => {
                      store.switchServer(entry.id)
                      void store.refresh(true).then(() => {
                        // 从登录层压进来的：选完这台就退回原页，登录层按新服务器重新弹
                        if (store.get().stack.length > 0) store.back()
                      })
                    }}
                    style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }}
                  >
                    <div className='m-t1' style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {entry.name || baseLabel(entry.base)}
                      {current ? (
                        <Badge variant='brand' shape='tag' className='m-badge m-badge-brand' style={{ height: 18, fontSize: 10.5 }}>
                          {t('当前')}
                        </Badge>
                      ) : null}
                    </div>
                    <div className='m-t2 m-mono' style={{ fontSize: 11.5 }}>
                      {baseLabel(entry.base)}
                    </div>
                  </Button>
                  <Button size='icon-touch' variant='outline'
                    type='button'
                    className='m-icon-btn'
                    aria-label={t('编辑')}
                    onClick={() => startEdit(entry.id)}
                    style={{ width: 30, height: 30, boxShadow: 'none' }}
                  >
                    <Icon name='edit' />
                  </Button>
                  <Button size='icon-touch' variant='outline'
                    type='button'
                    className='m-icon-btn'
                    aria-label={t('删除')}
                    onClick={() => {
                      store.deleteServer(entry.id)
                      store.toast(t('已删除'))
                      void store.refresh(true)
                    }}
                    style={{ width: 30, height: 30, boxShadow: 'none', color: 'var(--m-danger)' }}
                  >
                    <Icon name='trash' />
                  </Button>
                </div>
              )
            })}
          </Card>
        )}
      </div>

      <div className='m-section'>
        <SectionHead title={t('真机怎么连上电脑的网关')} />
        <Card className='m-card m-card-pad' style={{ fontSize: 12, color: 'var(--m-text-2)', lineHeight: 1.75 }}>
          <div style={{ fontWeight: 600, color: 'var(--m-text)' }}>{t('① 查电脑在局域网里的 IP')}</div>
          <div style={{ marginTop: 2 }}>
            {t('Windows 打开命令提示符跑 ipconfig，看「IPv4 地址」，一般是 192.168.x.x 或 10.x.x.x。手机和电脑要连同一个 WiFi。')}
          </div>

          <div style={{ fontWeight: 600, color: 'var(--m-text)', marginTop: 10 }}>{t('② 让网关监听局域网')}</div>
          <div style={{ marginTop: 2 }}>
            {t('桌面端在「设置 → 局域网访问」里打开；headless / Docker 用 AGENT2API_HOST=0.0.0.0 启动。只监听 127.0.0.1 时手机一定连不上。')}
          </div>

          <div style={{ fontWeight: 600, color: 'var(--m-text)', marginTop: 10 }}>{t('③ 放行端口')}</div>
          <div style={{ marginTop: 2 }}>
            {t('Windows 防火墙要允许该端口的入站连接，否则同一 WiFi 下也会超时。')}
          </div>
          <div
            className='m-mono'
            style={{ marginTop: 6, padding: '8px 10px', borderRadius: 9, background: 'var(--m-surface-2)', fontSize: 11, wordBreak: 'break-all', lineHeight: 1.6 }}
          >
            New-NetFirewallRule -DisplayName "Agent2API" -Direction Inbound -LocalPort {draftPort || DEFAULT_GATEWAY_PORT} -Protocol TCP -Action Allow
          </div>

          <div style={{ fontWeight: 600, color: 'var(--m-text)', marginTop: 10 }}>{t('④ 端口填哪个')}</div>
          <div style={{ marginTop: 2 }}>
            {t('网关默认 {port}。改过端口、走反向代理或内网穿透时，填实际对外那个端口；走 https 通常是 443 或 8443。', { port: String(DEFAULT_GATEWAY_PORT) })}
          </div>

          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--m-text-3)' }}>
            {t('保存前会先探活，连不上会当场告诉你，不会存进去。')}
          </div>
        </Card>
      </div>

      <div className='m-section' style={{ paddingBottom: 8 }}>
        <Card className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
          {t('每台服务器的登录状态各自独立保存，切换后不用重新登录。地址改掉后需要重新登录。')}
        </Card>
      </div>
    </div>
  )
}
