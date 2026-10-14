// WebSocket 客户端：连接管理（自动重连）+ 大厅/牌局状态分发
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { type ClientMsg, type DailyState, type ServerMsg, type TableSummary, type ViewState } from './protocol'
import { getToken } from './api'
import { useStore } from './store'

export interface SocketState {
  connected: boolean
  tables: TableSummary[]
  view: ViewState | null
  daily: DailyState | null
  lastError: string | null
  send: (msg: ClientMsg) => void
}

const SocketCtx = createContext<SocketState | null>(null)

export function SocketProvider({ children }: { children: ReactNode }) {
  const { online, user } = useStore()
  const enabled = online && !!user
  const [connected, setConnected] = useState(false)
  const [tables, setTables] = useState<TableSummary[]>([])
  const [view, setView] = useState<ViewState | null>(null)
  const [daily, setDaily] = useState<DailyState | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!enabled) return
    let closed = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed) return
      const token = getToken()
      if (!token) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
      wsRef.current = ws

      ws.onopen = () => {
        retry = 0
        setConnected(true)
      }
      ws.onmessage = (ev) => {
        let msg: ServerMsg
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (msg.t === 'tables') setTables(msg.tables)
        else if (msg.t === 'view') setView(msg.view)
        else if (msg.t === 'daily') setDaily(msg.daily)
        else if (msg.t === 'error') {
          setLastError(msg.message)
          setTimeout(() => setLastError(null), 3500)
        }
      }
      ws.onclose = () => {
        wsRef.current = null
        setConnected(false)
        if (closed) return
        retry = Math.min(retry + 1, 5)
        timer = setTimeout(connect, 800 * retry)
      }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      wsRef.current?.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [enabled])

  const send = useMemo(
    () => (msg: ClientMsg) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg))
      }
    },
    []
  )

  const value = useMemo(
    () => ({ connected, tables, view, daily, lastError, send }),
    [connected, tables, view, daily, lastError, send]
  )

  return <SocketCtx.Provider value={value}>{children}</SocketCtx.Provider>
}

/** 仅在在线模式组件树内使用 */
export function useSocket(): SocketState {
  const ctx = useContext(SocketCtx)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}

/** 可在 SocketProvider 外使用（离线时返回 null） */
export function useMaybeSocket(): SocketState | null {
  return useContext(SocketCtx)
}
