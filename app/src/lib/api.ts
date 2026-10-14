// REST 客户端：账号与在线状态检测
import type { PublicUser } from './protocol'

const TOKEN_KEY = 'bh-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as object) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `请求失败（${res.status}）`)
  return data as T
}

/** 2 秒内能连上后端即视为在线模式 */
export async function checkOnline(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch('/api/health', { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export const api = {
  register: (username: string, nickname: string, password: string) =>
    req<{ token: string; user: PublicUser }>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, nickname, password }),
    }),
  login: (username: string, password: string) =>
    req<{ token: string; user: PublicUser }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => req<{ user: PublicUser }>('/api/me'),
}
