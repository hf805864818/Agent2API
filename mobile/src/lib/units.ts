/**
 * 数字单位偏好。
 *
 * 桌面端「设置 → 通用 → 计量单位」有一个开关：中文单位（亿 / 万）或 K / M / B。
 * 报表、账号余额、token 读数都走同一套格式化，所以这档偏好必须放在格式化层，
 * 不能各页面自己写。
 *
 * 存在 localStorage、模块级缓存一份：格式化函数是纯函数，不能依赖 React 的
 * 重渲染，否则在事件回调里算出来的值会和界面上显示的不一致。设置页切换后调用
 * `setUnitMode`，随后进入的页面立刻按新单位渲染。
 */

export type UnitMode = 'cn' | 'si'

const STORAGE_KEY = 'agent2api-mobile-units'

function readStored(): UnitMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'si' ? 'si' : 'cn'
  } catch {
    return 'cn'
  }
}

let current: UnitMode = readStored()

export function unitMode(): UnitMode {
  return current
}

export function setUnitMode(next: UnitMode): void {
  current = next === 'si' ? 'si' : 'cn'
  try {
    localStorage.setItem(STORAGE_KEY, current)
  } catch {
    /* 隐私模式：只在本页生效 */
  }
}

export const UNIT_OPTIONS: Array<{ value: UnitMode; label: string }> = [
  { value: 'cn', label: '亿 / 万' },
  { value: 'si', label: 'K / M / B' },
]
