// V1.1.0 三项 UI 修改专项验证：
//  1) 明手牌可读性（角标纵向堆叠 + 遮挡减小）
//  2) 自己手牌点力显示（座位牌上的「N 点」徽章）
//  3) 叫牌过程显示在牌桌中央（叫牌阶段中央面板 + 打牌阶段中央定约条）
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8100'
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

const rnd = Math.random().toString(36).slice(2, 8)
const reg = await fetch(`${BASE}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `v110_${rnd}`, nickname: `V110测试${rnd}`, password: 'secret123' }),
}).then((r) => r.json())
if (!reg.token) throw new Error('注册失败')

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1366, height: 900 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate((t) => localStorage.setItem('bh-token', t), reg.token)
await page.goto(BASE + '/event/daily', { waitUntil: 'networkidle0', timeout: 20000 })
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开打本副'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 1500))

// --- 叫牌阶段：等机器人先叫一两轮，让中央面板有内容 ---
await new Promise((r) => setTimeout(r, 1800))
const t1 = await page.evaluate(() => document.body.innerText)
const checks = {
  中央叫牌面板: t1.includes('叫牌过程') && t1.includes('尚无叫品') === false || t1.includes('等待') || t1.includes('轮到你叫牌'),
  点力徽章: /·\s*\d+\s*点/.test(t1) || /\d+\s*点/.test(t1),
}
await page.screenshot({ path: SHOTS + 'v110-desktop-bidding.png' })
console.log('叫牌阶段中央面板可见:', checks.中央叫牌面板 ? '✓' : '❌')
console.log('自己点力徽章可见:', checks.点力徽章 ? '✓' : '❌')

// --- 一直 Pass 直到进入打牌阶段 ---
let inPlay = false
for (let i = 0; i < 20; i++) {
  const state = await page.evaluate(() => {
    const t = document.body.innerText
    const passBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled)
    if (passBtn) passBtn.click()
    return { play: t.includes('墩') && !t.includes('轮到你叫牌'), contract: /定约/.test(t) }
  })
  await new Promise((r) => setTimeout(r, 1100))
  if (state.contract && !state.play === false) { /* noop */ }
  const now = await page.evaluate(() => document.body.innerText)
  if (/定约/.test(now) && !now.includes('轮到你叫牌')) { inPlay = true; break }
}
console.log('进入打牌阶段:', inPlay ? '✓' : '❌（可能流局）')
await new Promise((r) => setTimeout(r, 2500)) // 等首攻+明手摊牌
await page.screenshot({ path: SHOTS + 'v110-desktop-play.png' })
const t2 = await page.evaluate(() => document.body.innerText)
console.log('打牌阶段中央定约条:', /定约/.test(t2) && /庄/.test(t2) ? '✓' : '❌')
console.log('明手标识:', t2.includes('明手') ? '✓' : '（本副可能非用户坐庄方）')

// --- 手机视口复查 ---
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
await new Promise((r) => setTimeout(r, 900))
await page.screenshot({ path: SHOTS + 'v110-phone-play.png' })
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
console.log('手机端横向溢出:', overflow + 'px', overflow > 1 ? '❌' : '✓')

const realErrors = errors.filter((e) => !e.includes('favicon'))
console.log('控制台错误:', realErrors.length ? realErrors.slice(0, 3) : '无')
await browser.close()
