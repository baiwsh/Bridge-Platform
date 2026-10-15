// BridgeHub 服务端：REST（账号）+ WebSocket（牌桌与对局同步）
import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerUser, loginUser, createSession, userByToken, publicUser } from './db'
import { Room, TableManager } from './rooms'
import { dailyDeal, dailyState, hasPlayed, recordDailyBoard } from './daily'
import { todayEvent } from '../src/lib/data'
import type { ClientMsg, ServerMsg, Seat } from '../src/lib/protocol'

const PORT = parseInt(process.env.PORT ?? '8100')
const __dir = dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json())

// ---------- REST：账号 ----------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'BridgeHub', time: new Date().toISOString() })
})

app.post('/api/register', (req, res) => {
  const { username, nickname, password } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' })
  const { user, error } = registerUser(String(username), String(nickname ?? ''), String(password))
  if (error || !user) return res.status(400).json({ error })
  const token = createSession(user.id)
  res.json({ token, user: publicUser(user) })
})

app.post('/api/login', (req, res) => {
  const { username, password } = req.body ?? {}
  const { user, error } = loginUser(String(username ?? ''), String(password ?? ''))
  if (error || !user) return res.status(401).json({ error })
  const token = createSession(user.id)
  res.json({ token, user: publicUser(user) })
})

app.get('/api/me', (req, res) => {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const user = userByToken(token)
  if (!user) return res.status(401).json({ error: '未登录或会话已过期' })
  res.json({ user: publicUser(user) })
})

// ---------- 静态资源（生产模式：托管前端构建产物） ----------
const distDir = join(__dir, '..', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api\/|ws).*/, (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

// ---------- WebSocket：牌桌与对局 ----------

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
const manager = new TableManager()

interface Client {
  ws: WebSocket
  userId: string
}
const clients = new Set<Client>()
const watchers = new Map<string, string>() // userId -> tableId（观战/浏览牌桌页但未入座）

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function roomOf(userId: string) {
  for (const room of manager.rooms.values()) {
    if (room.seatOf(userId) !== null) return room
  }
  return null
}

function broadcastAll() {
  const tables = manager.summaries()
  for (const c of clients) {
    send(c.ws, { t: 'tables', tables })
    const room = roomOf(c.userId)
    if (room) {
      send(c.ws, { t: 'view', view: room.viewFor(c.userId) })
      continue
    }
    const watchId = watchers.get(c.userId)
    const watchRoom = watchId ? manager.rooms.get(watchId) : null
    if (watchRoom) send(c.ws, { t: 'view', view: watchRoom.viewFor(c.userId) })
  }
}

manager.onLobbyChange(broadcastAll)

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', 'http://localhost')
  const token = url.searchParams.get('token') ?? ''
  const user = userByToken(token)
  if (!user) {
    send(ws, { t: 'error', message: '认证失败，请重新登录' })
    ws.close()
    return
  }
  const client: Client = { ws, userId: user.id }
  clients.add(client)
  manager.socketOpened(user.id)

  // 连接即同步大厅与（若已入座/观战的）牌桌视图
  send(ws, { t: 'tables', tables: manager.summaries() })
  const room = roomOf(user.id)
  if (room) {
    send(ws, { t: 'view', view: room.viewFor(user.id) })
  } else {
    const watchId = watchers.get(user.id)
    const watchRoom = watchId ? manager.rooms.get(watchId) : null
    if (watchRoom) send(ws, { t: 'view', view: watchRoom.viewFor(user.id) })
  }

  ws.on('message', (raw) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    const pub = publicUser(user)
    let err: string | null = null
    switch (msg.t) {
      case 'watch': {
        watchers.set(user.id, String(msg.tableId))
        const target = manager.rooms.get(String(msg.tableId))
        if (target) send(ws, { t: 'view', view: target.viewFor(user.id) })
        break
      }
      case 'unwatch': {
        watchers.delete(user.id)
        send(ws, { t: 'view', view: null })
        break
      }
      case 'create': {
        manager.createTable(pub, {
          name: String(msg.name || `${pub.nickname} 的牌桌`).slice(0, 24),
          system: msg.system === 'precision' ? 'precision' : 'natural',
          scoring: msg.scoring === 'imp' ? 'imp' : 'mp',
          boards: [4, 8, 12, 16].includes(msg.boards) ? msg.boards : 8,
          kind: ['quick', 'friends', 'bots'].includes(msg.kind) ? msg.kind : 'quick',
        })
        break
      }
      case 'join': {
        const target = manager.rooms.get(String(msg.tableId))
        if (!target) {
          err = '牌桌不存在'
          break
        }
        if (target.seatOf(user.id) === null && target.join(pub) === null) err = '座位已满'
        break
      }
      case 'takeover': {
        // 旁观者接管 AI 座位（仅限纯 AI，真人托管座位不可接管）
        const target = manager.rooms.get(String(msg.tableId))
        if (!target) {
          err = '牌桌不存在'
          break
        }
        if (!['N', 'E', 'S', 'W'].includes(String(msg.seat))) {
          err = '座位无效'
          break
        }
        if (target.seatOf(user.id) !== null) {
          err = '你已在本桌座位上'
          break
        }
        // 若在其他桌，先离开（隐藏房回收，普通房转托管）
        const cur = roomOf(user.id)
        if (cur) {
          if (cur.hidden) {
            cur.destroy()
            manager.rooms.delete(cur.id)
          } else {
            cur.leave(user.id)
          }
        }
        err = target.takeover(pub, msg.seat as Seat)
        if (!err) {
          watchers.delete(user.id)
          send(ws, { t: 'view', view: target.viewFor(user.id) })
        }
        break
      }
      case 'leave': {
        const room = roomOf(user.id)
        if (room?.hidden) {
          // 每日赛房间：离开即回收（未打完的副可稍后重打，不计成绩）
          room.destroy()
          manager.rooms.delete(room.id)
        } else {
          room?.leave(user.id)
        }
        send(ws, { t: 'view', view: null })
        break
      }
      case 'daily': {
        send(ws, { t: 'daily', daily: dailyState(user.id) })
        break
      }
      case 'dailyPlay': {
        const board = Number(msg.board)
        const event = todayEvent()
        if (!Number.isInteger(board) || board < 1 || board > event.boards.length) {
          err = '牌副不存在'
          break
        }
        if (hasPlayed(user.id, board)) {
          err = '该副已提交过成绩'
          break
        }
        const roomId = `daily-${event.date}-${user.id}-${board}`
        let room = manager.rooms.get(roomId)
        const resumable = room && room.started && room.gs?.phase !== 'scored' && room.seatOf(user.id) !== null
        if (!resumable) {
          if (room) {
            room.destroy()
            manager.rooms.delete(roomId)
          }
          // 先离开当前所在桌（普通桌转托管，隐藏桌回收）
          const cur = roomOf(user.id)
          if (cur) {
            if (cur.hidden) {
              cur.destroy()
              manager.rooms.delete(cur.id)
            } else {
              cur.leave(user.id)
            }
          }
          room = new Room({
            id: roomId,
            name: `${event.title} · 第 ${board} 副`,
            kind: 'event',
            system: event.system,
            scoring: 'mp',
            boards: 1,
            hidden: true,
            fixedBoardNo: board,
            seedDeal: () => dailyDeal(event.id, board),
            onBoardScored: (row) => {
              const e = recordDailyBoard(user.id, user.nickname, board, row.contract, row.nsScore)
              if (e) return
              // 成绩入库后给该玩家所有连接推送最新赛事状态
              for (const c of clients) {
                if (c.userId === user.id) send(c.ws, { t: 'daily', daily: dailyState(user.id) })
              }
            },
            onChange: () => broadcastAll(),
          })
          manager.rooms.set(roomId, room)
          room.joinAt(pub, 'S')
          room.start(user.id)
        }
        watchers.delete(user.id)
        if (!room) {
          err = '创建牌桌失败'
          break
        }
        send(ws, { t: 'view', view: room.viewFor(user.id) })
        break
      }
      case 'start': {
        const room = roomOf(user.id)
        err = room ? room.start(user.id) : '请先入座'
        break
      }
      case 'bid': {
        const room = roomOf(user.id)
        err = room ? room.bid(user.id, msg.call) : '你不在任何牌桌'
        break
      }
      case 'play': {
        const room = roomOf(user.id)
        err = room ? room.play(user.id, msg.card) : '你不在任何牌桌'
        break
      }
      case 'next': {
        const room = roomOf(user.id)
        err = room ? room.next(user.id) : '你不在任何牌桌'
        break
      }
      case 'restart': {
        const room = roomOf(user.id)
        err = room ? room.restart(user.id) : '你不在任何牌桌'
        break
      }
    }
    if (err) send(ws, { t: 'error', message: err })
    broadcastAll()
  })

  ws.on('close', () => {
    clients.delete(client)
    manager.socketClosed(user.id)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[BridgeHub] 服务已启动: http://localhost:${PORT} (REST /api/* + WS /ws)`)
})
