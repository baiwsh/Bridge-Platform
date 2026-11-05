// 协议级验收（v1.8.3）：
//   1) 每墩 4 张收齐 → 清台约 2000ms
//   2) 本副最后一墩：4 张牌停留约 5000ms 后才进入 scored（结果卡）
// 用法：先起服务端（快节奏）  BOT_BID_MS=80 BOT_PLAY_MS=120 PORT=8100 BRIDGEHUB_DATA=.tmp-final node dist-server/index.js
import WebSocket from 'ws'
import { rmSync } from 'node:fs'

const API = 'http://localhost:8100'
const WS = 'ws://localhost:8100'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const r = Math.random().toString(36).slice(2, 8)
const reg = await fetch(`${API}/api/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `fin_${r}`, nickname: `终墩${r}`, password: 'secret123' }),
}).then((x) => x.json())
if (!reg.token) { console.log('✘ 注册失败', reg); process.exit(1) }

const ws = new WebSocket(`${WS}/ws?token=${reg.token}`)
let tableId = null
const gaps = []            // 每墩 收齐→清台
let tTrickFull = 0
let lastTrickStart = 0
let scoredGap = null
let trickNo = 0
const deadline = Date.now() + 180000

const bid = () => {
  // 尽快结束叫牌：直接叫满贯上限 7NT（永远合法），AI 全 Pass 后立刻进入打牌
  ws.send(JSON.stringify({ t: 'bid', tableId, call: { type: 'bid', level: 7, strain: 'NT' } }))
}
// legalPlayIds 是 'S14' 这类牌 id，play 消息需要完整牌对象
const play = (ids) => {
  const id = ids[0]
  const suit = id[0]
  const rank = parseInt(id.slice(1), 10)
  ws.send(JSON.stringify({ t: 'play', tableId, card: { suit, rank } }))
}

ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: `终墩-${r}`, system: 'precision', scoring: 'mp', boards: 1, kind: 'bots' })))
ws.on('error', (e) => { console.log('✘ WS 错误', e.message); process.exit(1) })

ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.t !== 'view' || !m.view || m.view.tableId !== tableId) {
    if (m.t === 'tables' && !tableId) {
      const t = (m.tables || []).find((x) => x.name === `终墩-${r}`)
      if (!t) return
      tableId = t.id
      ws.send(JSON.stringify({ t: 'join', tableId }))
      setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 300)
    }
    return
  }
  const v = m.view
  const len = (v.trick || []).length
  if (v.phase === 'bidding' && v.myTurn) bid()
  else if (v.phase === 'play' && v.myTurn && len < 4 && v.legalPlayIds?.length) {
    if (len === 3) { trickNo++; tTrickFull = 0 }
    play(v.legalPlayIds)
  }
  if (v.phase === 'play' && len === 4) {
    if (!tTrickFull) tTrickFull = Date.now()
    const empty = Object.values(v.counts || {}).every((c) => c === 0)
    if (empty && !lastTrickStart) { lastTrickStart = Date.now(); console.log(`  [最后一墩] 第 ${trickNo} 墩 4 张收齐，开始计时 5 秒停留…`) }
  }
  if (v.phase === 'play' && len === 0 && tTrickFull) {
    gaps.push(Date.now() - tTrickFull)
    tTrickFull = 0
  }
  if (v.phase === 'scored' && lastTrickStart && scoredGap === null) {
    scoredGap = Date.now() - lastTrickStart
    report()
  }
})

function report() {
  console.log(`\n各墩 收齐→清台（应约 2000ms）: ${gaps.map((g) => `${g}ms`).join(' / ')}`)
  const bad = gaps.filter((g) => g < 1700 || g > 2600)
  console.log(`最后一墩 4 张收齐 → scored 结果卡（应约 5000ms）: ${scoredGap}ms`)
  const okTrick = gaps.length > 0 && bad.length === 0
  const okFinal = scoredGap >= 4400 && scoredGap <= 6000
  console.log(`\n结论：普通墩 ${okTrick ? '✓ 全部约 2 秒' : '✘ ' + bad.join(',')}; 最后一墩 ${okFinal ? '✓ 约 5 秒' : '✘ 偏差过大'}`)
  ws.close()
  try { rmSync(new URL('../.tmp-final', import.meta.url), { recursive: true, force: true }) } catch {}
  process.exit(okTrick && okFinal ? 0 : 1)
}

setTimeout(() => { console.log('✘ 超时未打完本副'); ws.close(); process.exit(1) }, 180000)
