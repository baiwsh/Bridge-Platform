import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { initialTables, type BridgeTable } from './data'
import { api, checkOnline, getToken, setToken } from './api'

// ---------------------------------------------------------------------------
// 账号体系：在线优先（后端 REST），后端不可达时自动回退本地 localStorage 模式

export interface User {
  id: string
  username: string
  nickname: string
  color: string
  passwordHash?: string // 仅离线模式本地保存
  createdAt: string
  rating: number
  gamesPlayed: number
  bestPct: number
}

interface StoredUser extends User {}

function hash(pw: string): string {
  // 演示级散列（非安全用途），正式环境请使用后端 + bcrypt/argon2
  let h = 5381
  const s = 'bridgehub·' + pw
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const AVATAR_COLORS = ['#e11d48', '#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#f97316', '#d946ef', '#22d3ee']

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

// ---------------------------------------------------------------------------

export interface BoardEntry {
  board: number
  contract: string
  nsScore: number
}

interface StoreState {
  user: User | null
  users: User[]
  /** true = 已连接后端（联机模式）；false = 离线单机模式 */
  online: boolean
  tables: BridgeTable[]
  /** eventId -> 玩家录入的各副成绩 */
  entries: Record<string, BoardEntry[]>
  register: (username: string, nickname: string, password: string) => Promise<string | null>
  login: (username: string, password: string) => Promise<string | null>
  logout: () => void
  createTable: (t: Omit<BridgeTable, 'id' | 'seats' | 'status'>) => BridgeTable
  joinTable: (tableId: string) => void
  leaveTable: (tableId: string) => void
  saveEntry: (eventId: string, entry: BoardEntry) => void
  removeEntry: (eventId: string, board: number) => void
  finishEvent: (eventId: string, pct: number) => void
  recordCasualGame: () => void
}

const StoreCtx = createContext<StoreState | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<StoredUser[]>(() => load('bh-users', []))
  const [sessionId, setSessionId] = useState<string | null>(() => load<string | null>('bh-session', null))
  const [tables, setTables] = useState<BridgeTable[]>(() => {
    const custom = load<BridgeTable[]>('bh-tables', [])
    return [...custom, ...initialTables()]
  })
  const [entries, setEntries] = useState<Record<string, BoardEntry[]>>(() => load('bh-entries', {}))
  const [online, setOnline] = useState(false)
  const [onlineUser, setOnlineUser] = useState<User | null>(null)

  useEffect(() => save('bh-users', users), [users])
  useEffect(() => save('bh-session', sessionId), [sessionId])
  useEffect(() => {
    save('bh-tables', tables.filter((t) => t.hostId))
  }, [tables])
  useEffect(() => save('bh-entries', entries), [entries])

  // 启动时探测后端；在线且有令牌则恢复云端会话
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await checkOnline()
      if (cancelled) return
      setOnline(ok)
      if (ok && getToken()) {
        try {
          const { user } = await api.me()
          if (!cancelled) setOnlineUser(user as User)
        } catch {
          setToken(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const localUser = useMemo(() => users.find((u) => u.id === sessionId) ?? null, [users, sessionId])
  const user = online ? onlineUser : localUser

  const register: StoreState['register'] = async (username, nickname, password) => {
    const name = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,16}$/.test(name)) return '用户名需为 3–16 位字母、数字或下划线'
    if (password.length < 6) return '密码至少 6 位'
    if (online) {
      try {
        const { token, user } = await api.register(name, nickname.trim(), password)
        setToken(token)
        setOnlineUser(user as User)
        return null
      } catch (e) {
        return e instanceof Error ? e.message : '注册失败'
      }
    }
    if (users.some((u) => u.username === name)) return '该用户名已被注册'
    const u: User = {
      id: 'u-' + Math.random().toString(36).slice(2, 10),
      username: name,
      nickname: nickname.trim() || name,
      color: AVATAR_COLORS[users.length % AVATAR_COLORS.length],
      passwordHash: hash(password),
      createdAt: new Date().toISOString(),
      rating: 1200,
      gamesPlayed: 0,
      bestPct: 0,
    }
    setUsers((prev) => [...prev, u])
    setSessionId(u.id)
    return null
  }

  const login: StoreState['login'] = async (username, password) => {
    if (online) {
      try {
        const { token, user } = await api.login(username, password)
        setToken(token)
        setOnlineUser(user as User)
        return null
      } catch (e) {
        return e instanceof Error ? e.message : '登录失败'
      }
    }
    const u = users.find((x) => x.username === username.trim().toLowerCase())
    if (!u) return '账号不存在，请先注册'
    if (u.passwordHash !== hash(password)) return '密码不正确'
    setSessionId(u.id)
    return null
  }

  const logout = () => {
    setToken(null)
    setOnlineUser(null)
    setSessionId(null)
  }

  const createTable: StoreState['createTable'] = (t) => {
    const table: BridgeTable = {
      ...t,
      id: 't-' + Math.random().toString(36).slice(2, 8),
      seats: user ? [user.nickname, t.kind === 'bots' ? 'bot-echo' : null, null, t.kind === 'bots' ? 'bot-echo' : null] : [null, null, null, null],
      status: 'waiting',
      hostId: user?.id,
    }
    setTables((prev) => [table, ...prev])
    return table
  }

  const joinTable: StoreState['joinTable'] = (tableId) => {
    if (!user) return
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== tableId) return t
        if (t.seats.includes(user.nickname)) return t
        const idx = t.seats.findIndex((s) => s === null)
        if (idx === -1) return t
        const seats = [...t.seats]
        seats[idx] = user.nickname
        const full = seats.every(Boolean)
        return { ...t, seats, status: full ? 'full' : 'waiting' }
      })
    )
  }

  const leaveTable: StoreState['leaveTable'] = (tableId) => {
    if (!user) return
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== tableId) return t
        const seats = t.seats.map((s) => (s === user.nickname ? null : s))
        return { ...t, seats, status: 'waiting' }
      })
    )
  }

  const saveEntry: StoreState['saveEntry'] = (eventId, entry) => {
    setEntries((prev) => {
      const list = (prev[eventId] ?? []).filter((e) => e.board !== entry.board)
      return { ...prev, [eventId]: [...list, entry].sort((a, b) => a.board - b.board) }
    })
  }

  const removeEntry: StoreState['removeEntry'] = (eventId, board) => {
    setEntries((prev) => ({
      ...prev,
      [eventId]: (prev[eventId] ?? []).filter((e) => e.board !== board),
    }))
  }

  const finishEvent: StoreState['finishEvent'] = (_eventId, pct) => {
    if (!user) return
    setUsers((prev) =>
      prev.map((u) =>
        u.id === user.id
          ? { ...u, gamesPlayed: u.gamesPlayed + 1, bestPct: Math.max(u.bestPct, Math.round(pct * 10) / 10) }
          : u
      )
    )
  }

  const recordCasualGame: StoreState['recordCasualGame'] = () => {
    setUsers((prev) => prev.map((u) => (u.id === sessionId ? { ...u, gamesPlayed: u.gamesPlayed + 1 } : u)))
  }

  const value: StoreState = {
    user,
    users,
    online,
    tables,
    entries,
    register,
    login,
    logout,
    createTable,
    joinTable,
    leaveTable,
    saveEntry,
    removeEntry,
    finishEvent,
    recordCasualGame,
  }

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore(): StoreState {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
