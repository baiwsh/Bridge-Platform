// V1.2.0 三项修改专项验证：
//  1) 叫牌盘不再遮挡自己的手牌（几何断言：叫牌盘底边 <= 手牌顶边）
//  2) 旁观功能：未入座用户进牌桌页可看到「旁观中」且无操作盘
//  3) 重新进入时自动回到在打的牌桌 + 大厅「回到牌桌」横幅
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8100'
const TABLE = process.env.TABLE_ID ?? 't-102' // 精确之道：3 bot + 1 空位
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

let failed = false
const check = (name, ok) => { console.log(`${ok ? '✓' : '❌'} ${name}`); if (!ok) failed = true }

async function reg(prefix) {
  const rnd = Math.random().toString(36).slice(2, 8)
  const r = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `${prefix}_${rnd}`, nickname: `${prefix}${rnd}`, password: 'secret123' }),
  }).then((r) => r.json())
  if (!r.token) throw new Error('注册失败 ' + prefix)
  return r
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})

const A = await reg('v120a')
const B = await reg('v120b')

async function newPage(token) {
  const p = await browser.newPage()
  await p.setViewport({ width: 1366, height: 900 })
  p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await p.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
  await p.evaluate((t) => localStorage.setItem('bh-token', t), token)
  return p
}

// ---------- A 入座 t-102 并开始 ----------
const pa = await newPage(A.token)
await pa.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1200))
await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '入座')?.click())
await new Promise((r) => setTimeout(r, 800))
await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始牌局'))?.click())
await new Promise((r) => setTimeout(r, 1500))
const started = await pa.evaluate(() => document.body.innerText)
check('A 开始牌局进入叫牌阶段', started.includes('叫牌过程'))

// ---------- 1) 等到 A 叫牌，测量叫牌盘与手牌的几何关系 ----------
let myTurn = false
for (let i = 0; i < 24; i++) {
  const t = await pa.evaluate(() => document.body.innerText)
  if (t.includes('轮到你叫牌')) { myTurn = true; break }
  if (t.includes('定约')) break // 叫牌意外结束
  await new Promise((r) => setTimeout(r, 700))
}
check('轮到 A 叫牌', myTurn)
if (myTurn) {
  const geo = await pa.evaluate(() => {
    const pass = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled)
    if (!pass) return null
    const passRect = pass.getBoundingClientRect()
    // 自己手牌：角标纵向堆叠，innerText 含换行（如 "K\n♠"），叫牌按钮无换行（如 "2♣"）
    const cards = [...document.querySelectorAll('button')]
      .filter((b) => /^([2-9]|10|J|Q|K|A)\n[♠♥♦♣]/.test(b.innerText))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.top > window.innerHeight * 0.55)
    if (!cards.length) return null
    return { boxBottom: Math.round(passRect.bottom), handTop: Math.round(Math.min(...cards.map((r) => r.top))), cards: cards.length }
  })
  console.log('  几何:', JSON.stringify(geo))
  check('叫牌盘不遮挡手牌', !!geo && geo.boxBottom <= geo.handTop + 1 && geo.cards === 13)
  await pa.screenshot({ path: SHOTS + 'v120-bidding.png' })
}

// ---------- 2) B 旁观 ----------
const pb = await newPage(B.token)
await pb.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 2000))
const spect = await pb.evaluate(() => document.body.innerText)
check('B 看到旁观中标识', spect.includes('旁观中'))
check('B 能看到叫牌过程/定约', spect.includes('叫牌过程') || spect.includes('定约'))
const spectHasBox = await pb.evaluate(
  () => !![...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled)
)
check('B 无叫牌操作盘', !spectHasBox)
await pb.screenshot({ path: SHOTS + 'v120-spectate.png' })

// ---------- 3) A 重新打开页面 → 自动回到牌桌 ----------
const pa2 = await newPage(A.token)
await pa2.goto(`${BASE}/lobby`, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 3000))
check('重新进入后自动跳回牌桌', pa2.url().includes(`/table/${TABLE}`))
await pa2.screenshot({ path: SHOTS + 'v120-autoreturn.png' })
// 手动经 SPA 回大厅（整页刷新会触发自动回桌，属预期行为）→ 应出现「回到牌桌」横幅
await pa2.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('大厅'))?.click())
await new Promise((r) => setTimeout(r, 1500))
const lobbyText = await pa2.evaluate(() => document.body.innerText)
check('大厅出现「回到牌桌」横幅', lobbyText.includes('回到牌桌'))
await pa2.screenshot({ path: SHOTS + 'v120-lobby-banner.png' })

await browser.close()
console.log(failed ? '\nV1.2 验证失败 ❌' : '\nV1.2 验证通过 ✅')
process.exit(failed ? 1 : 0)
