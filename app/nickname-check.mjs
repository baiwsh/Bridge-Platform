// v1.9.0 昵称修改端到端验收：
//   1) PUT /api/profile 改昵称，GET /api/me 持久化生效
//   2) 非法昵称（空 / 超长 / 尖括号）与未登录请求被正确拒绝或净化
//   3) 正在牌桌中的座位显示名随昵称修改实时刷新（WS view 广播）
// 用法：先起服务端  PORT=8100 BRIDGEHUB_DATA=.tmp-nick node dist-server/index.js
import WebSocket from 'ws'

const API = 'http://localhost:8100'
const WS = 'ws://localhost:8100'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = false
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? '✓' : '✘'} ${label}${extra ? ' · ' + extra : ''}`)
  if (!cond) failed = true
}

const r = Math.random().toString(36).slice(2, 8)
const reg = await fetch(`${API}/api/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `nick_${r}`, nickname: '旧昵称', password: 'secret123' }),
}).then((x) => x.json())
if (!reg.token) { console.log('✘ 注册失败', reg); process.exit(1) }
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${reg.token}` }

const me0 = await fetch(`${API}/api/me`, { headers: auth }).then((x) => x.json())
ok(me0.user.nickname === '旧昵称', '注册时昵称正确', me0.user.nickname)

const upd = await fetch(`${API}/api/profile`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ nickname: '桥牌高手小明' }),
})
const body = await upd.json()
ok(upd.status === 200 && body.user?.nickname === '桥牌高手小明', '修改为中文昵称成功', `status=${upd.status}`)

const me1 = await fetch(`${API}/api/me`, { headers: auth }).then((x) => x.json())
ok(me1.user.nickname === '桥牌高手小明' && me1.user.username === `nick_${r}`, '刷新后昵称持久化、用户名不变')

for (const [nick, label] of [['', '空昵称'], ['一二三四五六七八九十一二三四五六七', '超长昵称']]) {
  const res = await fetch(`${API}/api/profile`, { method: 'PUT', headers: auth, body: JSON.stringify({ nickname: nick }) })
  ok(res.status === 400, `${label}被拒绝`, `status=${res.status}`)
}
const xss = await fetch(`${API}/api/profile`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ nickname: '<script>牌手' }),
}).then((x) => x.json())
ok(!/<|>/.test(xss.user?.nickname ?? '<'), '尖括号被净化', xss.user?.nickname)
const noAuth = await fetch(`${API}/api/profile`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '未登录' }),
})
ok(noAuth.status === 401, '未登录请求返回 401', `status=${noAuth.status}`)

// ---- 牌桌座位名实时刷新 ----
await fetch(`${API}/api/profile`, { method: 'PUT', headers: auth, body: JSON.stringify({ nickname: '座位原名' }) })
const ws = new WebSocket(`${WS}/ws?token=${reg.token}`)
let tableId = null
let mySeat = null
let nameBefore = null
let nameAfter = null
let renameSent = false
const tableName = `昵称-${r}`

ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: tableName, system: 'natural', scoring: 'mp', boards: 4, kind: 'bots' })))
ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.t === 'tables' && !tableId) {
    const t = (m.tables || []).find((x) => x.name === tableName)
    if (!t) return
    tableId = t.id
    ws.send(JSON.stringify({ t: 'watch', tableId }))
  }
  if (m.t === 'view' && m.view?.tableId === tableId) {
    mySeat = m.view.mySeat
    if (mySeat) {
      const name = m.view.players?.[mySeat]?.name
      if (!renameSent) {
        if (name === '座位原名' && !nameBefore) {
          nameBefore = name
          renameSent = true
          fetch(`${API}/api/profile`, { method: 'PUT', headers: auth, body: JSON.stringify({ nickname: '新座位名' }) })
        }
      } else if (name === '新座位名') {
        nameAfter = name
      }
    }
  }
})

const deadline = Date.now() + 12000
while (Date.now() < deadline && !nameAfter) await sleep(120)
ok(nameBefore === '座位原名', '入座时座位名为修改前昵称', String(nameBefore))
ok(nameAfter === '新座位名', '修改昵称后牌桌座位名实时刷新', String(nameAfter))
ws.close()

console.log(`\n结论：${failed ? '✘ 存在失败项' : '✓ 昵称修改与牌桌同步全部通过'}`)
process.exit(failed ? 1 : 0)
