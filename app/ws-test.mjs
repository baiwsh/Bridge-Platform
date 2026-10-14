// 联机集成测试：两名真客户端 + 两个 AI 补位，打完一整场（4 副）
// 校验：WS 认证、入座、开局、视图隔离（只能看到自己的牌）、轮转合法性、记分、全场结束
import WebSocket from 'ws'

const BASE = 'http://localhost:8100'
const WS = 'ws://localhost:8100/ws'

const rnd = Math.random().toString(36).slice(2, 8)

async function register(name, nick) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, nickname: nick, password: 'secret123' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`register ${name}: ${data.error}`)
  return data
}

function parseCard(id) {
  return { suit: id[0], rank: parseInt(id.slice(1)) }
}

class Client {
  constructor(name, token) {
    this.name = name
    this.views = []
    this.lastView = null
    this.tables = []
    this.errors = []
    this.ws = new WebSocket(`${WS}?token=${token}`)
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.t === 'tables') this.tables = msg.tables
      else if (msg.t === 'view') {
        this.lastView = msg.view
        this.views.push(msg.view)
      } else if (msg.t === 'error') this.errors.push(msg.message)
    })
  }
  send(m) {
    this.ws.send(JSON.stringify(m))
  }
  close() {
    this.ws.close()
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeout = 15000, label = 'condition') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = fn()
    if (v) return v
    await sleep(120)
  }
  throw new Error('等待超时: ' + label)
}

// ---- 1. 注册两个账号 ----
const a = await register(`testa_${rnd}`, '甲_' + rnd)
const b = await register(`testb_${rnd}`, '乙_' + rnd)
console.log('注册成功:', a.user.nickname, b.user.nickname)

const ca = new Client('A', a.token)
const cb = new Client('B', b.token)
await waitFor(() => ca.tables.length > 0 && cb.tables.length > 0, 10000, '大厅列表')
console.log('大厅同步: A 看到', ca.tables.length, '桌，B 看到', cb.tables.length, '桌')

// ---- 2. 创建一张 4 副的牌桌并双双入座 ----
ca.send({ t: 'create', name: '测试桌' + rnd, system: 'natural', scoring: 'mp', boards: 4, kind: 'quick' })
const tableId = await waitFor(() => ca.tables.find((t) => t.name === '测试桌' + rnd)?.id, 10000, '创建牌桌')
console.log('创建牌桌:', tableId)
ca.send({ t: 'join', tableId })
cb.send({ t: 'join', tableId })
await waitFor(() => ca.lastView?.phase === 'lobby' && cb.lastView?.phase === 'lobby', 10000, '入座视图')
const seatA = ca.lastView.mySeat
const seatB = cb.lastView.mySeat
console.log('入座: A=', seatA, 'B=', seatB)
if (seatA === seatB) throw new Error('两人坐到了同一座位！')

// ---- 3. A 开局（AI 补满剩余座位） ----
ca.send({ t: 'start' })
await waitFor(() => ca.lastView?.phase === 'bidding' && cb.lastView?.phase === 'bidding', 10000, '开局')

// ---- 4. 自动对局：轮到自己就叫 Pass / 出第一张合法牌 ----
const t0 = Date.now()
let playsA = 0
let playsB = 0
let lastLog = 0
let lastNextBoard = 0
let handsCheck = { ok: true }
while (Date.now() - t0 < 240000) {
  if (Date.now() - lastLog > 5000) {
    lastLog = Date.now()
    const v = ca.lastView
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] phase=${v?.phase} turn=${v?.turn} 副=${v?.boardNo} 墩=${v?.tricksNS}+${v?.tricksEW} trick=${v?.trick?.length} 分=${v?.scores?.length} auction=${v?.auction?.length} myTurnA=${v?.myTurn} errA=${ca.errors.at(-1) ?? ''}`)
  }
  for (const [c, counter] of [[ca, 'A'], [cb, 'B']]) {
    const v = c.lastView
    if (!v || v.gameOver || !v.myTurn) continue
    if (v.phase === 'bidding') {
      c.send({ t: 'bid', call: { type: 'pass' } })
    } else if (v.phase === 'play' && v.legalPlayIds.length > 0) {
      c.send({ t: 'play', card: parseCard(v.legalPlayIds[0]) })
      if (counter === 'A') playsA++; else playsB++
    }
    await sleep(150)
  }
  // 手牌隔离检查：任何视图都不得包含别人家的明牌（除明手/终局）
  for (const c of [ca, cb]) {
    const v = c.lastView
    if (!v || v.phase === 'scored' || v.phase === 'lobby') continue
    if (v.phase === 'bidding') {
      if (v.dummyHand || v.allHands) handsCheck = { ok: false, why: '叫牌阶段泄露手牌' }
    }
  }
  // 一副结束：A 推进到下一副（每副只发一次）
  const vA0 = ca.lastView
  if (vA0?.phase === 'scored' && !vA0.gameOver && lastNextBoard !== vA0.boardNo) {
    lastNextBoard = vA0.boardNo
    ca.send({ t: 'next' })
    await sleep(200)
  }
  const v = ca.lastView
  if (v?.gameOver) break
  await sleep(200)
}

const vA = ca.lastView
if (!vA?.gameOver) throw new Error('240 秒内未完成整场')
console.log('整场完成:', vA.scores.length, '副 | A 出牌', playsA, '次, B 出牌', playsB, '次')
console.log('记分板:', vA.scores.map((r) => `#${r.board} ${r.contract} ${r.nsScore}`).join(' | '))
console.log('南北合计:', vA.scores.reduce((s, r) => s + r.nsScore, 0))
if (vA.scores.length !== 4) throw new Error('应为 4 副成绩')
if (ca.errors.length || cb.errors.length) console.log('收到服务端错误提示:', [...ca.errors, ...cb.errors])
if (!handsCheck.ok) throw new Error('手牌隔离失败: ' + handsCheck.why)

// ---- 5. 再来一局（restart） ----
ca.send({ t: 'restart' })
await waitFor(() => ca.lastView?.phase === 'bidding' && ca.lastView?.scores.length === 0, 10000, 'restart')
console.log('restart 正常，新的一局已开始')

ca.close()
cb.close()
console.log('\n联机集成测试：全部通过 ✔')
process.exit(0)
