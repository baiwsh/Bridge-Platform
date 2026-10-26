// 手机端明手牌「角标（点数+花色）是否被相邻牌遮挡」检测
// 用法：node mobile-dummy-check.mjs [桌数]
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import WebSocket from 'ws'

const APP = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SHOTS = APP + 'shots/'
mkdirSync(SHOTS, { recursive: true })
const DATA = APP + '.tmp-mobile/'
rmSync(DATA, { recursive: true, force: true })
mkdirSync(DATA, { recursive: true })

const BASE = 'http://localhost:7100'
const API = 'http://localhost:8100'
const WS = 'ws://localhost:8100'
const TABLES = parseInt(process.argv[2] ?? '3', 10)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const srv = spawn('node', ['dist-server/index.js'], {
  cwd: APP, env: { ...process.env, PORT: '8100', BRIDGEHUB_DATA: DATA, BOT_BID_MS: '150', BOT_PLAY_MS: '600' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
srv.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`))
const vite = spawn('npx', ['vite', '--port', '7100', '--strictPort'], { cwd: APP, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
vite.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`))

async function waitUrl(u, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u); if (r.ok) return true } catch {}
    await sleep(500)
  }
  return false
}

const cleanup = () => { try { srv.kill() } catch {} ; try { vite.kill() } catch {} }

if (!(await waitUrl(`${API}/api/health`))) { console.log('✘ 后端未就绪'); cleanup(); process.exit(1) }
if (!(await waitUrl(BASE))) { console.log('✘ vite 未就绪'); cleanup(); process.exit(1) }
console.log('✓ 后端 :8100 与 vite :7100 已就绪\n')

const PROBE = () => {
  // 本副结束后结果卡会盖住牌桌中央，属预期行为，不参与遮挡判定
  const m = document.body.innerText.match(/第 \d+ 副结束/)
  if (m) return { found: false, skipped: 'scored', why: m[0] }
  const isCard = (b) => (b.className || '').includes('rounded-md')
  const suit = (b) => /[♠♥♦♣]/.test(b.textContent || '')
  const cardBtn = (b) => isCard(b) && suit(b)
  const dummyLabel = [...document.querySelectorAll('span')].find((s) => (s.textContent || '').includes('（明手）'))
  const seatRoot = dummyLabel ? dummyLabel.closest('div.absolute') : null
  if (!seatRoot) return { found: false }
  // 用几何位置判定座位（类名里的 top-1/2 会让左右座位被误判成 top）
  const sr = seatRoot.getBoundingClientRect()
  const pr = seatRoot.parentElement.getBoundingClientRect()
  const relX = sr.left + sr.width / 2 - (pr.left + pr.width / 2)
  const relY = sr.top + sr.height / 2 - (pr.top + pr.height / 2)
  const pos = Math.abs(relY) > Math.abs(relX) ? (relY > 0 ? 'bottom' : 'top') : (relX > 0 ? 'right' : 'left')
  const cards = [...seatRoot.querySelectorAll('button')].filter(cardBtn)
  const table = seatRoot.parentElement
  const tRect = table ? table.getBoundingClientRect() : null
  const items = cards.map((b, i) => {
    const r = b.getBoundingClientRect()
    const corner = b.querySelector('span')
    const kids = corner ? [...corner.children] : []
    const rankEl = kids[0], suitEl = kids[1]
    const check = (el) => {
      if (!el) return null
      const q = el.getBoundingClientRect()
      if (q.width <= 0 || q.height <= 0) return null
      const pts = [[q.left + q.width / 2, q.top + q.height / 2], [q.left + 1, q.top + 1], [q.right - 1, q.bottom - 1], [q.right - 1, q.top + 1]]
      const owners = pts.map(([x, y]) => {
        const el2 = document.elementFromPoint(x, y)
        if (!el2) return 'null'
        return el2.closest('button') === b ? 'self' : `other<${el2.tagName} ${String(el2.className).slice(0, 70)}>`
      })
      const covered = owners.filter((o) => o.startsWith('other')).length
      return { covered, total: pts.length, owners: owners.join('|'), top: Math.round(q.top), bottom: Math.round(q.bottom), left: Math.round(q.left), right: Math.round(q.right) }
    }
    return {
      i, cardW: Math.round(r.width), cardH: Math.round(r.height),
      cardTop: Math.round(r.top), cardBottom: Math.round(r.bottom), cardLeft: Math.round(r.left), cardRight: Math.round(r.right),
      rank: check(rankEl), suit: check(suitEl),
    }
  })
  return {
    found: true, pos, n: cards.length, items,
    table: tRect ? { top: Math.round(tRect.top), bottom: Math.round(tRect.bottom), left: Math.round(tRect.left), right: Math.round(tRect.right) } : null,
    vw: window.innerWidth, vh: window.innerHeight,
  }
}

async function newUser() {
  // 服务端有 20 次/5 分钟 的注册限流，被限流时等一会儿再试
  for (let i = 0; i < 5; i++) {
    const r = Math.random().toString(36).slice(2, 8)
    const u = await fetch(`${API}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `mob_${r}`, nickname: `手机${r}`, password: 'secret123' }),
    }).then((x) => x.json())
    if (u.token) return u.token
    await sleep(20000)
  }
  throw new Error('注册被限流')
}

/** 点一张可出的牌：若首攻方是自己，不点的话明手永远不会摊牌 */
const playOne = (page) =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.className || '').includes('ring-amber-400'))
    if (b) { b.click(); return true }
    return false
  })

function openTable(token, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/ws?token=${token}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('建桌超时')) }, 15000)
    let joined = false
    ws.on('message', (raw) => {
      let m
      try { m = JSON.parse(raw.toString()) } catch { return }
      if (m.t !== 'tables') return
      const t = (m.tables || []).find((x) => x.name === name)
      if (!t) return
      if (!joined) {
        joined = true
        ws.send(JSON.stringify({ t: 'join', tableId: t.id }))
        setTimeout(() => { ws.send(JSON.stringify({ t: 'start' })); clearTimeout(timer); ws.close(); resolve(t.id) }, 600)
      }
    })
    ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name, system: 'precision', scoring: 'mp', boards: 8, kind: 'bots' })))
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

async function advanceToPlay(page, mode = 'bid') {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => document.body.innerText)
    if (t.includes('定约')) return true
    if (t.includes('轮到你叫牌')) {
      // pass 模式：只 Pass，让 AI 做庄，明手就有机会落在左/右座位（纵向牌堆）
      if (mode === 'pass' && Date.now() < deadline - 45000) {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(
            (x) => x.innerText.trim() === 'Pass' && !x.disabled && x.closest('div.rounded-xl')
          )
          if (b) b.click()
        })
        await sleep(250)
        continue
      }
      for (const lv of ['7', '5', '3', '1']) {
        const okLv = await page.evaluate((l) => {
          const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === l && !x.disabled)
          if (b) { b.click(); return true }
          return false
        }, lv)
        if (!okLv) continue
        await sleep(120)
        const okS = await page.evaluate(() => {
          for (const st of ['♣', '♦', '♥', '♠']) {
            const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === st && !x.disabled)
            if (b) { b.click(); return true }
          }
          return false
        })
        if (okS) break
      }
      if (!(await page.evaluate(() => document.body.innerText)).includes('定约')) {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(
            (x) => x.innerText.trim() === 'Pass' && !x.disabled && x.closest('div.rounded-xl')
          )
          if (b) b.click()
        })
      }
    }
    await sleep(250)
  }
  return false
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--no-proxy-server'],
})

const VIEWS = [
  { name: 'iPhone12-390x844', width: 390, height: 844 },
  { name: 'small-360x780', width: 360, height: 780 },
]

let anyFail = false
for (let t = 0; t < TABLES; t++) {
  const vp = VIEWS[t % VIEWS.length]
  const mode = t % 2 === 0 ? 'bid' : 'pass'
  await sleep(2000) // 避开注册限流
  const page = await browser.newPage()
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: true, hasTouch: true })
  const token = await newUser()
  const tableId = await openTable(token, `手机遮挡-${t}-${Math.random().toString(36).slice(2, 5)}`)
  await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle0' })
  await page.evaluate((tk) => localStorage.setItem('bh-token', tk), token)
  await page.goto(`${BASE}/table/${tableId}`, { waitUntil: 'networkidle0' })
  await sleep(1200)
  if (!(await advanceToPlay(page, mode))) { console.log('第 ' + (t + 1) + ' 桌：进入打牌阶段超时'); await page.close(); continue }
  // 等首攻落地（明手摊牌）：必要时替人类座位出一张，否则明手一直不摊牌
  await sleep(1500)
  for (let k = 0; k < 3; k++) {
    const played = await playOne(page)
    if (!played) break
    await sleep(1200)
  }
  await sleep(1500)
  const r = await page.evaluate(PROBE)
  await page.screenshot({ path: `${SHOTS}mobile-dummy-${vp.name}-t${t + 1}.png` })
  if (!r.found) {
    const txt = r.why ? '命中: ' + r.why : await page.evaluate(() => document.body.innerText.slice(0, 300))
    console.log(`第 ${t + 1} 桌（${vp.name} / ${mode}）：${r.skipped === 'scored' ? '本副已结束（结果卡盖住牌桌，跳过）' : '未找到明手标签'}`)
    console.log('  页面文本：' + JSON.stringify(txt.replace(/\n+/g, ' | ').slice(0, 260)))
    await page.close(); continue
  }
  const bad = r.items.filter((it) => (it.suit && it.suit.covered > 0) || (it.rank && it.rank.covered > 0))
  const suitBad = r.items.filter((it) => it.suit && it.suit.covered > 0)
  const overflow = r.table
    ? r.items.filter((it) => it.cardTop < r.table.top - 1 || it.cardBottom > r.table.bottom + 1 || it.cardLeft < r.table.left - 1 || it.cardRight > r.table.right + 1).length
    : 0
  console.log(`第 ${t + 1} 桌 ${vp.name} / ${mode}：明手在 ${r.pos}，${r.n} 张牌，牌 ${r.items[0]?.cardW}×${r.items[0]?.cardH}`)
  console.log(`  花色角标被遮：${suitBad.length}/${r.items.length} 张；点数或花色任一被遮：${bad.length} 张；超出牌桌容器：${overflow} 张`)
  if (r.table) {
    const tw = r.table.right - r.table.left
    const minL = Math.min(...r.items.map((i) => i.cardLeft)), maxR = Math.max(...r.items.map((i) => i.cardRight))
    const minT = Math.min(...r.items.map((i) => i.cardTop)), maxB = Math.max(...r.items.map((i) => i.cardBottom))
    console.log(`  牌桌容器宽 ${tw}；牌堆 ${maxR - minL}×${maxB - minT}（左 ${minL - r.table.left} / 右余 ${r.table.right - maxR}；上 ${minT - r.table.top} / 下余 ${r.table.bottom - maxB}）`)
    const it0 = r.items[0], it1 = r.items[1]
    if (it0?.suit && it1) console.log(`  角标：花色宽 ${it0.suit.right - it0.suit.left}，距牌左边 ${it0.suit.left - it0.cardLeft}；相邻牌间距（可见宽/高）${r.pos === 'top' || r.pos === 'bottom' ? it1.cardLeft - it0.cardLeft : it1.cardTop - it0.cardTop}`)
    const vert = r.pos === 'left' || r.pos === 'right'
    const maxCorner = Math.max(
      ...r.items.map((i) => (i.suit ? (vert ? i.suit.bottom - i.cardTop : i.suit.right - i.cardLeft) : 0)),
      ...r.items.map((i) => (i.rank ? (vert ? i.rank.bottom - i.cardTop : i.rank.right - i.cardLeft) : 0))
    )
    const visible = r.items[1] ? (vert ? r.items[1].cardTop - r.items[0].cardTop : r.items[1].cardLeft - r.items[0].cardLeft) : 0
    console.log(`  角标最大右/下边界 ${maxCorner}px ≤ 可见 ${visible}px → ${maxCorner <= visible ? '✓ 有余量' : '✘ 会被压住'}`)
  }
  const sample = r.items.slice(0, 3).map((it) => `#${it.i} 角标top=${it.suit?.top} bottom=${it.suit?.bottom} 覆盖=${it.suit?.owners}`)
  sample.forEach((s) => console.log('   ' + s))
  if (suitBad.length > 0) {
    anyFail = true
    console.log('  ✘ 存在花色被遮盖的牌：', suitBad.map((it) => `#${it.i}(${it.suit?.covered}/${it.suit?.total})`).join(' '))
  } else {
    console.log('  ✓ 全部牌的花色角标均可见')
  }
  await page.close()
}

await browser.close()
cleanup()
rmSync(DATA, { recursive: true, force: true })
console.log(`\n结论：${anyFail ? '✘ 存在遮挡，需要修复' : '✓ 未发现遮挡'}`)
process.exit(anyFail ? 1 : 0)
