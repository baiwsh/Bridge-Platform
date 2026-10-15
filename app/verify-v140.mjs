// V1.4.0 「牌前叫牌卡条」专项验证：
//  1) 叫牌阶段：每个座位已叫的叫品以小卡条显示在该座位牌前（卡条数 = 叫品总数）
//  2) 打牌阶段：卡条仍然保留（便于读牌）
//  3) 自己的卡条在自己手牌上方（几何断言，不遮牌）
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8100'
const TABLE = process.env.TABLE_ID ?? 't-102'
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

let failed = false
const check = (name, ok) => { console.log(`${ok ? '✓' : '❌'} ${name}`); if (!ok) failed = true }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rnd = Math.random().toString(36).slice(2, 8)
const A = await fetch(`${BASE}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `v140_${rnd}`, nickname: `v140${rnd}`, password: 'secret123' }),
}).then((r) => r.json())
if (!A.token) throw new Error('注册失败')

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})
const pa = await browser.newPage()
await pa.setViewport({ width: 1366, height: 900 })
pa.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await pa.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
await pa.evaluate((t) => localStorage.setItem('bh-token', t), A.token)
await pa.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
await sleep(1200)
await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '入座')?.click())
await sleep(800)
await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始牌局'))?.click())
await sleep(1500)
check('A 开始牌局进入叫牌阶段', (await pa.evaluate(() => document.body.innerText)).includes('叫牌过程'))

// 卡条 = class 含 bg-white/90 的 span；中央面板叫品格 = 文本精确匹配的叶子 div
const counts = () =>
  pa.evaluate(() => {
    const pat = /^(Pass|X|XX|[1-7](♠|♥|♦|♣|NT)•?)$/
    const chips = [...document.querySelectorAll('span')].filter((s) => s.className.includes('bg-white/90'))
    const panelCells = [...document.querySelectorAll('div')].filter(
      (d) => d.className.includes('py-0.5') && pat.test(d.textContent.trim()) && !d.querySelector('div')
    )
    return { chips: chips.length, panel: panelCells.length }
  })

// ---------- 1) 叫牌阶段卡条 ----------
let c1 = null
for (let i = 0; i < 20; i++) {
  c1 = await counts()
  if (c1.chips >= 3) break
  await sleep(500)
}
console.log('  叫牌阶段:', JSON.stringify(c1))
check('叫牌阶段出现牌前卡条', !!c1 && c1.chips >= 3)
check('卡条数与中央面板叫品数一致', !!c1 && c1.chips === c1.panel)
await pa.screenshot({ path: SHOTS + 'v140-bidding-chips.png' })

// ---------- 2) A 自动 Pass 直到叫牌结束，卡条在打牌阶段保留 ----------
let inPlay = false
for (let i = 0; i < 60; i++) {
  const t = await pa.evaluate(() => document.body.innerText)
  if (!t.includes('叫牌过程') && t.includes('定约')) { inPlay = true; break } // 面板卸载 + 定约气泡 = 打牌阶段
  if (t.includes('轮到你叫牌')) {
    await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled)?.click())
  }
  await sleep(500)
}
check('进入打牌阶段', inPlay)
await sleep(1200)
const c2 = await counts()
console.log('  打牌阶段:', JSON.stringify(c2))
check('打牌阶段卡条保留', c2.chips >= 3)
await pa.screenshot({ path: SHOTS + 'v140-play-chips.png' })

// ---------- 3) 自己的卡条在手牌上方（不遮牌） ----------
const geo = await pa.evaluate(() => {
  const chips = [...document.querySelectorAll('span')].filter((s) => s.className.includes('bg-white/90'))
  // 自己手牌：底部明牌按钮，innerText 形如 "K\n♠"
  const myCards = [...document.querySelectorAll('button')]
    .map((b) => b.getBoundingClientRect())
    .filter((r) => r.top > window.innerHeight * 0.6 && r.width > 20 && r.width < 60)
  // 自己卡条：位于屏幕下半部的 chip
  const myChips = chips.map((s) => s.getBoundingClientRect()).filter((r) => r.top > window.innerHeight * 0.45)
  if (!myCards.length || !myChips.length) return null
  return {
    chipBottom: Math.round(Math.max(...myChips.map((r) => r.bottom))),
    handTop: Math.round(Math.min(...myCards.map((r) => r.top))),
    chips: myChips.length,
  }
})
console.log('  几何:', JSON.stringify(geo))
check('自己的卡条在手牌上方不遮牌', !!geo && geo.chipBottom <= geo.handTop + 1)

await browser.close()
console.log(failed ? '\nV1.4 验证失败 ❌' : '\nV1.4 验证通过 ✅')
process.exit(failed ? 1 : 0)
