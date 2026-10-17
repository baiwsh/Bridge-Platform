// V1.5.0 「紧凑两段式叫牌盘」专项验证：
//  1) 叫牌盘高度大幅缩小（< 160px，旧版约 350px）
//  2) 叫牌盘不遮挡自己的手牌（几何断言）
//  3) 两段式叫牌可用：先点阶数再点花色，叫品成功提交
//  4) 合法性控制：未选阶数时花色不可点
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
  body: JSON.stringify({ username: `v150_${rnd}`, nickname: `v150${rnd}`, password: 'secret123' }),
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

// ---------- 等轮到 A 叫牌 ----------
let myTurn = false
for (let i = 0; i < 30; i++) {
  const t = await pa.evaluate(() => document.body.innerText)
  if (t.includes('轮到你叫牌')) { myTurn = true; break }
  if (!t.includes('叫牌过程')) break
  await sleep(500)
}
check('轮到 A 叫牌', myTurn)

// ---------- 1) + 2) 叫牌盘尺寸与不遮牌 ----------
const geo = await pa.evaluate(() => {
  const pass = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled)
  if (!pass) return null
  const box = pass.closest('div.rounded-xl')
  const boxRect = box.getBoundingClientRect()
  const myCards = [...document.querySelectorAll('button')]
    .filter((b) => /^([2-9]|10|J|Q|K|A)\n[♠♥♦♣]/.test(b.innerText))
    .map((b) => b.getBoundingClientRect())
    .filter((r) => r.top > window.innerHeight * 0.55)
  return {
    boxHeight: Math.round(boxRect.height),
    boxBottom: Math.round(boxRect.bottom),
    handTop: myCards.length ? Math.round(Math.min(...myCards.map((r) => r.top))) : null,
    cards: myCards.length,
  }
})
console.log('  几何:', JSON.stringify(geo))
check('叫牌盘高度 < 160px（旧版约 350px）', !!geo && geo.boxHeight < 160)
check('叫牌盘不遮挡手牌', !!geo && geo.handTop !== null && geo.boxBottom <= geo.handTop + 1)
await pa.screenshot({ path: SHOTS + 'v150-compact-box.png' })

// ---------- 3) 未选阶数时花色不可点 ----------
const strainDisabled = await pa.evaluate(() => {
  const nt = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'NT')
  return nt ? nt.disabled : null
})
check('未选阶数时花色按钮禁用', strainDisabled === true)

// ---------- 4) 两段式叫牌：选阶数 → 选花色 ----------
const chipsBefore = await pa.evaluate(() => [...document.querySelectorAll('span')].filter((s) => s.className.includes('bg-white/90')).length)
// 选一个可用的最高阶数（更可能覆盖禁用逻辑），这里选 1 阶（开局一定可用或已被叫到则选更高）
const picked = await pa.evaluate(() => {
  const levels = [...document.querySelectorAll('button')].filter((b) => /^[1-7]$/.test(b.innerText.trim()))
  const usable = levels.filter((b) => !b.disabled)
  if (!usable.length) return null
  const lv = usable[0] // 最小可用阶数
  lv.click()
  return lv.innerText.trim()
})
console.log('  选中阶数:', picked)
check('可以选中阶数', !!picked)
await sleep(400)
await pa.screenshot({ path: SHOTS + 'v150-level-picked.png' })
const strainPicked = await pa.evaluate(() => {
  const strains = [...document.querySelectorAll('button')].filter((b) => ['♣', '♦', '♥', '♠', 'NT'].includes(b.innerText.trim()) && !b.disabled)
  if (!strains.length) return null
  const s = strains[0]
  s.click()
  return s.innerText.trim()
})
console.log('  选中花色:', strainPicked)
check('选中阶数后花色可点并已提交', !!strainPicked)
await sleep(900)
const chipsAfter = await pa.evaluate(() => [...document.querySelectorAll('span')].filter((s) => s.className.includes('bg-white/90')).length)
console.log('  卡条数:', chipsBefore, '->', chipsAfter)
check('叫品提交成功（牌前卡条增加）', chipsAfter >= chipsBefore + 1)
const bodyText = await pa.evaluate(() => document.body.innerText)
check('叫牌过程显示新叫品', bodyText.includes(`${picked}${strainPicked === 'NT' ? 'NT' : strainPicked}`))
await pa.screenshot({ path: SHOTS + 'v150-bid-done.png' })

await browser.close()
console.log(failed ? '\nV1.5 验证失败 ❌' : '\nV1.5 验证通过 ✅')
process.exit(failed ? 1 : 0)
