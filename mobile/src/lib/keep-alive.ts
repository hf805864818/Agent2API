import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * 保活服务的 JS 桥。
 *
 * Web / 浏览器形态没有原生插件，全部降级成 no-op —— 浏览器标签页本身由浏览器
 * 管理生命周期，JavaScript 无权也没有必要申请前台服务。APK 里才真正调用原生。
 */
type KeepAlivePlugin = {
  start(options: { server: string }): Promise<{ running: boolean }>
  stop(): Promise<{ running: boolean }>
  status(): Promise<{ running: boolean }>
  setStartOnBoot(options: { enabled: boolean }): Promise<{ enabled: boolean }>
  getStartOnBoot(): Promise<{ enabled: boolean }>
}

const KeepAlive = registerPlugin<KeepAlivePlugin>('KeepAlive')

export function nativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('KeepAlive')
}

export async function startKeepAlive(server: string): Promise<boolean> {
  if (!nativeAvailable()) return false
  const result = await KeepAlive.start({ server })
  return Boolean(result.running)
}

export async function stopKeepAlive(): Promise<boolean> {
  if (!nativeAvailable()) return false
  const result = await KeepAlive.stop()
  return Boolean(result.running)
}

export async function keepAliveStatus(): Promise<boolean> {
  if (!nativeAvailable()) return false
  const result = await KeepAlive.status()
  return Boolean(result.running)
}

export async function setStartOnBoot(enabled: boolean): Promise<boolean> {
  if (!nativeAvailable()) return false
  const result = await KeepAlive.setStartOnBoot({ enabled })
  return Boolean(result.enabled)
}

export async function getStartOnBoot(): Promise<boolean> {
  if (!nativeAvailable()) return false
  const result = await KeepAlive.getStartOnBoot()
  return Boolean(result.enabled)
}
