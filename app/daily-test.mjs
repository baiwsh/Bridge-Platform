// 每日双人赛（服务端版）集成测试：
// 注册 → 拉取赛事状态 → 开打第 1 副（自动 Pass / 出合法牌打完）→ 校验成绩入库与排行榜 → 重打应被拒
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
  constructor(token) {
    this.lastView = null
    this.daily = null
    this.errors = []
    this.ws = new WebSocket(`${WS}?token=${token}`)
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.t === 'view') this.lastView = msg.view
      else if (msg.t === 'daily') this.daily = msg.daily
      else if (msg.t === 'error') this.errors.push(msg.message)
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

async function waitFor(fn, timeout = 30000, label = 'condition') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = fn()
    if (v) return v
    await sleep(120)
  }
  throw new Error('等待超时: ' + label)
}

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg)
  console.log('  ✓', msg)
}

// 自动行动：叫牌永远 Pass，出牌出第一张合法牌
function autoAct(c) {
  const v = c.lastView
  if (!v || !v.myTurn) return
  if (v.phase === 'bidding') {
    c.send({ t: 'bid', call: { type: 'P' } })
  } else if (v.phase === 'play' && v.legalPlayIds.length > 0) {
    c.send({ t: 'play', card: parseCard(v.legalPlayIds[0]) })
  }
}

const { user, token } = await register(`daily_${rnd}`, '每日测试')
console.log(`注册成功: ${user.nickname} (${user.id})`)

const c = new Client(token)
await sleep(400) // 等连接建立（连接后服务端会先推 tables，本测试不消费）

// 1. 拉取每日赛状态
c.send({ t: 'daily' })
const st0 = await waitFor(() => c.daily, 10000, '收到 daily 状态')
assert(st0.boards.length === 8, '赛事共 8 副')
assert(st0.myDone === 0, '初始进度 0/8')
assert(st0.leaderboard.length === 7, '排行榜初始含 7 对模拟对手')
assert(st0.live.length === 0, '暂无进行中的真人')

// 2. 开打第 1 副
c.send({ t: 'dailyPlay', board: 1 })
const v0 = await waitFor(() => c.lastView && c.lastView.tableId.startsWith('daily-') ? c.lastView : null, 10000, '进入赛事牌桌')
assert(v0.mySeat === 'S', '真人固定坐南')
assert(v0.phase === 'bidding', '自动开局进入叫牌')
assert(v0.boardNo === 1 && v0.boards === 1, '固定副号=1，单场 1 副')
assert(v0.myHand.length === 13, '手牌 13 张')

// 3. 自动打完（每收到视图就尝试行动）
const timer = setInterval(() => autoAct(c), 150)
const vEnd = await waitFor(() => c.lastView?.phase === 'scored' ? c.lastView : null, 60000, '第 1 副打完')
clearInterval(timer)
assert(vEnd.result && typeof vEnd.result.nsScore === 'number', `记分完成: ${vEnd.result.contract} → ${vEnd.result.nsScore}`)

// 4. 服务端推送了更新后的 daily 状态
const st1 = await waitFor(() => c.daily && c.daily.myDone === 1 ? c.daily : null, 10000, 'daily 状态更新为 1/8')
const b1 = st1.boards.find((b) => b.board === 1)
assert(b1.played && b1.contract === vEnd.result.contract && b1.nsScore === vEnd.result.nsScore, '成绩入库且与牌局结果一致')
assert(typeof b1.mp === 'number' && b1.maxMp > 0, `本副比赛分 ${b1.mp}/${b1.maxMp} MP`)
assert(st1.live.some((l) => l.you && l.done === 1), '未完赛真人出现在"进行中"名单')
assert(st1.leaderboard.length === 7, '未完赛不进总榜（仍 7 对模拟对手）')

// 5. 离开牌桌，房间应被回收
c.send({ t: 'leave' })
await sleep(300)

// 6. 重打第 1 副应被拒绝
c.errors.length = 0
c.send({ t: 'dailyPlay', board: 1 })
await waitFor(() => c.errors.length > 0, 5000, '收到重打拒绝')
assert(c.errors.includes('该副已提交过成绩'), '重复打同一副被拒绝（防刷分）')

// 7. 第二个玩家打同一副：发牌必须与第一个玩家完全相同（固定种子全场同牌）
const u2 = await register(`daily2_${rnd}`, '每日测试乙')
const c2 = new Client(u2.token)
await sleep(400)
c2.send({ t: 'daily' })
await waitFor(() => c2.daily, 5000, '乙收到 daily 状态')
c2.send({ t: 'dailyPlay', board: 1 })
const v2 = await waitFor(() => c2.lastView && c2.lastView.tableId.startsWith('daily-') ? c2.lastView : null, 10000, '乙进入赛事牌桌')
const hand1 = v0.myHand.map((x) => x.suit + x.rank).sort().join(',')
const hand2 = v2.myHand.map((x) => x.suit + x.rank).sort().join(',')
assert(hand1 === hand2, '两名玩家同一副拿到完全相同的手牌（全场同牌）')
assert(c2.daily.live.some((l) => l.name === '每日测试' && l.done === 1), '乙能看到甲在"进行中"名单')

// 乙也打完第 1 副
const timer2 = setInterval(() => autoAct(c2), 150)
await waitFor(() => c2.lastView?.phase === 'scored', 60000, '乙打完第 1 副')
clearInterval(timer2)
await waitFor(() => c2.daily && c2.daily.myDone === 1, 10000, '乙成绩入库')

c.close()
c2.close()
console.log('\n全部通过 ✅')
process.exit(0)
