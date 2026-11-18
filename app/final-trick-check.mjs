// 协议级验收（v1.9.0）：
//   1) 普通墩 4 张收齐 → 清台约 2000ms
//   2) 最后一墩 4 张收齐 → 立即结算并「无限期暂停」：
//      scored 后等待远超旧版 5 秒，boardNo / phase / 桌上四张牌都不得变化
//   3) 只有发送 { t:'next' } 才重新发牌（boardNo+1、trick 清空）
// 用法：先起服务端  BOT_BID_MS=80 BOT_PLAY_MS=120 PORT=8100 BRIDGEHUB_DATA=.tmp-final node dist-server/index.js
import WebSocket from 'ws'

const API = 'http://localhost:8100'
const WS = 'ws://localhost:8100'

const r = Math.random().toString(36).slice(2, 8)
const reg = await fetch(`${API}/api/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `fin_${r}`, nickname: `暂停${r}`, password: 'secret123' }),
}).then((x) => x.json())
if (!reg.token) { console.log('✘ 注册失败', reg); process.exit(1) }

const ws = new WebSocket(`${WS}/ws?token=${reg.token}`)
let tableId = null
const gaps = []
let tTrickFull = 0
let scoredAt = 0
let prevViewAt = 0
let lastViewAt = 0
let lastView = null
let nextSent = false
let nextOk = false
let boardAtScored = 0
const checks = []

const bid = () => ws.send(JSON.stringify({ t: 'bid', tableId, call: { type: 'bid', level: 7, strain: 'NT' } }))
const play = (ids) => {
  const id = ids[0]
  ws.send(JSON.stringify({ t: 'play', tableId, card: { suit: id[0], rank: parseInt(id.slice(1), 10) } }))
}

ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: `暂停-${r}`, system: 'precision', scoring: 'mp', boards: 2, kind: 'bots' })))
ws.on('error', (e) => { console.log('✘ WS 错误', e.message); process.exit(1) })

ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.t !== 'view' || !m.view || m.view.tableId !== tableId) {
    if (m.t === 'tables' && !tableId) {
      const t = (m.tables || []).find((x) => x.name === `暂停-${r}`)
      if (!t) return
      tableId = t.id
      ws.send(JSON.stringify({ t: 'join', tableId }))
      setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 300)
    }
    return
  }
  const v = m.view
  prevViewAt = lastViewAt
  lastViewAt = Date.now()
  lastView = v
  const len = (v.trick || []).length

  if (v.phase === 'bidding' && v.myTurn) bid()
  else if (v.phase === 'play' && v.myTurn && len < 4 && v.legalPlayIds?.length) play(v.legalPlayIds)

  // 普通墩：收齐 → 清台
  if (v.phase === 'play' && len === 4) {
    if (!tTrickFull) tTrickFull = Date.now()
  }
  if (v.phase === 'play' && len === 0 && tTrickFull) {
    gaps.push(Date.now() - tTrickFull)
    tTrickFull = 0
  }

  if (v.phase === 'scored' && !scoredAt) {
    scoredAt = Date.now()
    boardAtScored = v.boardNo
    console.log(`  最后一墩 → 结算间隔：${scoredAt - prevViewAt}ms（应远小于旧版 5000ms）`)
    console.log(`  结算视图：phase=${v.phase} boardNo=${v.boardNo} 桌面牌数=${len} 四家牌=${v.allHands ? '已摊开' : '缺失'}`)
    checks.push({ label: '结算时四张牌仍在桌面', ok: len === 4 })
    checks.push({ label: '结算时四家牌可复盘', ok: !!v.allHands })
    checks.push({ label: '最后一张出完后立即结算（无 5 秒计时）', ok: scoredAt - prevViewAt < 800 })

    // 结算后分两次强制刷新视图，确认服务端没有任何自动推进
    setTimeout(() => {
      ws.send(JSON.stringify({ t: 'watch', tableId }))
      setTimeout(() => {
        const q = lastView
        checks.push({
          label: '结算后 +2.5s 仍暂停（boardNo 未变、仍 scored、四张牌仍在）',
          ok: q?.phase === 'scored' && q.boardNo === boardAtScored && (q.trick || []).length === 4,
        })
      }, 200)
    }, 2500)
    setTimeout(() => {
      ws.send(JSON.stringify({ t: 'watch', tableId }))
      setTimeout(() => {
        const q = lastView
        checks.push({
          label: '结算后 +7s（超过旧版 5 秒）仍暂停',
          ok: q?.phase === 'scored' && q.boardNo === boardAtScored && (q.trick || []).length === 4,
        })
        // 只有点「下一副」才继续
        if (!nextSent) { nextSent = true; ws.send(JSON.stringify({ t: 'next', tableId })) }
      }, 200)
    }, 7000)
  }

  if (nextSent && !nextOk && v.phase !== 'scored' && v.boardNo === boardAtScored + 1) {
    nextOk = true
    console.log(`  点击「下一副」后：boardNo=${v.boardNo} phase=${v.phase} 桌面牌数=${len}`)
    report()
  }
})

function report() {
  const bad = gaps.filter((g) => g < 1500 || g > 3200)
  console.log(`\n各墩 收齐→清台（应约 2000ms）: ${gaps.map((g) => `${g}ms`).join(' / ')}`)
  const okGap = gaps.length >= 10 && bad.length === 0
  const okChecks = checks.length === 5 && checks.every((c) => c.ok)
  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✘'} ${c.label}`)
  console.log(`\n结论：普通墩 ${okGap ? '✓ 全部约 2 秒' : '✘ ' + bad.join(',')}; ` +
              `无限期暂停 ${okChecks ? '✓' : '✘'}; ` +
              `点「下一副」才继续 ${nextOk ? '✓' : '✘'}`)
  ws.close()
  process.exit(okGap && okChecks && nextOk ? 0 : 1)
}

setTimeout(() => { console.log('✘ 超时：未观察到完整流程'); ws.close(); process.exit(1) }, 150000)
