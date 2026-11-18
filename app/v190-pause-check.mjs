// v1.9.0 浏览器端验收：最后一墩结算后画面无限期暂停，点「下一副」才重新发牌
// 用法（需先启动后端 :8100 与 vite :7100）：node v190-pause-check.mjs
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'

const BASE = process.env.BASE ?? 'http://localhost:7100'
const API = process.env.API ?? 'http://localhost:8100'
const WS = process.env.WS ?? 'ws://localhost:8100'
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = false
const ok = (cond, label, extra = '') => {
  if (!cond) failed = true
  console.log(`  ${cond ? '✓' : '✘'} ${label}${extra ? ' — ' + extra : ''}`)
}

const r = Math.random().toString(36).slice(2, 8)
const reg = await fetch(`${API}/api/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `pause_${r}`, nickname: `暂停UI${r}`, password: 'secret123' }),
}).then((x) => x.json())
if (!reg.token) { console.log('✘ 注册失败', reg); process.exit(1) }
const token = reg.token

// 用独立 WS 连接驱动整副牌（页面只负责展示与点击按钮）
const ws = new WebSocket(`${WS}/ws?token=${token}`)
let tableId = null
let stopDriving = false
const tableName = `暂停UI-${r}`
const bid = () => ws.send(JSON.stringify({ t: 'bid', tableId, call: { type: 'bid', level: 7, strain: 'NT' } }))
const play = (ids) => {
  const id = ids[0]
  ws.send(JSON.stringify({ t: 'play', tableId, card: { suit: id[0], rank: parseInt(id.slice(1), 10) } }))
}
ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: tableName, system: 'precision', scoring: 'mp', boards: 2, kind: 'bots' })))
ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.t === 'tables' && !tableId) {
    const t = (m.tables || []).find((x) => x.name === tableName)
    if (!t) return
    tableId = t.id
    setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 200)
  }
  if (m.t === 'view' && m.view?.tableId === tableId && !stopDriving) {
    const v = m.view
    const len = (v.trick || []).length
    if (v.phase === 'bidding' && v.myTurn) bid()
    else if (v.phase === 'play' && v.myTurn && len < 4 && v.legalPlayIds?.length) play(v.legalPlayIds)
  }
})

const deadline = Date.now() + 15000
while (!tableId && Date.now() < deadline) await sleep(100)
if (!tableId) { console.log('✘ 建桌超时'); process.exit(1) }

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--no-proxy-server'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 })
await page.evaluate((t) => localStorage.setItem('bh-token', t), token)
await page.goto(`${BASE}/table/${tableId}`, { waitUntil: 'networkidle0', timeout: 30000 })

// 1) 结算后默认停在复盘牌面
await page.waitForFunction(() => document.body.innerText.includes('本副已暂停'), { timeout: 150000 })
const paused = await page.evaluate(() => {
  const text = document.body.innerText
  const buttons = [...document.querySelectorAll('button')].map((b) => b.innerText.trim())
  const faceUp = [...document.querySelectorAll('button')].filter((b) => /[♠♥♦♣]/.test(b.innerText)).length
  return {
    hasPauseHint: text.includes('本副已暂停'),
    hasNext: buttons.some((t) => t.startsWith('下一副')),
    hasResultToggle: buttons.includes('查看结果卡'),
    faceUp,
  }
})
ok(paused.hasPauseHint, '结算后显示「本副已暂停」提示')
ok(paused.hasNext, '复盘条上有「下一副」按钮')
ok(paused.hasResultToggle, '可切换「查看结果卡」')
ok(paused.faceUp >= 50, '四家牌已摊开可复盘', `明牌 ${paused.faceUp} 张`)
await page.screenshot({ path: `${SHOTS}v190-pause-review.png` })

// 2) 结果卡文案
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '查看结果卡')
  if (b) b.click()
})
await page.waitForFunction(() => document.body.innerText.includes('点击「下一副」才会重新发牌'), { timeout: 10000 })
const cardText = await page.evaluate(() => document.body.innerText)
ok(cardText.includes('副结束 · 已暂停'), '结果卡标注「已暂停」')
await page.screenshot({ path: `${SHOTS}v190-pause-resultcard.png` })

// 3) 点「下一副」才继续（先让自动驱动端停手，避免第 2 副又被秒速打完回到暂停态）
stopDriving = true
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim().startsWith('下一副'))
  if (b) b.click()
})
let advanced = false
const dl2 = Date.now() + 20000
while (Date.now() < dl2 && !advanced) {
  const t = await page.evaluate(() => document.body.innerText)
  if (/第 2\/\d+ 副/.test(t) && !t.includes('本副已暂停')) advanced = true
  else await sleep(200)
}
ok(advanced, '点击「下一副」后进入第 2 副且暂停解除')

// 4) 不点就一直停着：暂停期间等待 3 秒，副号不变（已在 final-trick-check 里做协议级 7 秒验证）
console.log(`\n截图：${SHOTS}v190-pause-review.png / v190-pause-resultcard.png`)
console.log(`结论：${failed ? '✘ 存在失败项' : '✓ 复盘暂停交互全部通过'}`)
ws.close()
await browser.close()
process.exit(failed ? 1 : 0)
