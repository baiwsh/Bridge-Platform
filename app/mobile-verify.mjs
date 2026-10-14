// 移动端/平板适配验证：手机与平板视口遍历主要页面 + 牌桌开打冒烟，截图检查
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:7100'
const API = 'http://localhost:8100'
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

const rnd = Math.random().toString(36).slice(2, 8)
const reg = await fetch(`${API}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `mob_${rnd}`, nickname: `移动测试${rnd}`, password: 'secret123' }),
}).then((r) => r.json())
if (!reg.token) throw new Error('注册失败')

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})

const viewports = [
  { name: 'phone', width: 390, height: 844 },   // iPhone 14
  { name: 'tablet', width: 820, height: 1180 }, // iPad Air
]
const pages = [
  ['/', 'home'],
  ['/lobby', 'lobby'],
  ['/event/daily', 'daily'],
  ['/scoring', 'scoring'],
  ['/systems', 'systems'],
  ['/profile', 'profile'],
]

let failed = false
for (const vp of viewports) {
  const page = await browser.newPage()
  await page.setViewport({ ...vp, isMobile: vp.name === 'phone', hasTouch: true })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
  await page.evaluate((t) => localStorage.setItem('bh-token', t), reg.token)

  for (const [path, name] of pages) {
    await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 20000 })
    await new Promise((r) => setTimeout(r, 700))
    // 检查水平溢出（页面不应出现横向滚动）
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    await page.screenshot({ path: `${SHOTS}m-${vp.name}-${name}.png` })
    const bad = overflow > 1
    if (bad) failed = true
    console.log(`[${vp.name}] ${path} 横向溢出: ${overflow}px ${bad ? '❌' : '✓'}`)
  }

  // 手机端牌桌冒烟：每日赛开打第 1 副，验证牌桌在窄屏渲染
  if (vp.name === 'phone') {
    await page.goto(BASE + '/event/daily', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 1200))
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开打本副'))
      btn?.click()
    })
    await new Promise((r) => setTimeout(r, 2500))
    const t1 = await page.evaluate(() => document.body.innerText)
    const inTable = t1.includes('第 1/1 副')
    console.log(`[phone] 每日赛开打进入牌桌: ${inTable ? '✓' : '❌'}`)
    if (!inTable) failed = true
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    console.log(`[phone] 牌桌横向溢出: ${overflow}px ${overflow > 1 ? '❌' : '✓'}`)
    if (overflow > 1) failed = true
    await page.screenshot({ path: `${SHOTS}m-phone-daily-game.png` })
    // 叫一次 Pass 验证叫牌盘可点
    const bidOk = await page.evaluate(() => {
      const passBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled)
      if (passBtn) { passBtn.click(); return true }
      return false
    })
    await new Promise((r) => setTimeout(r, 1500))
    const t2 = await page.evaluate(() => document.body.innerText)
    console.log(`[phone] 叫牌盘点击 Pass: ${bidOk ? '✓' : '（可能未轮到，跳过）'} | 界面仍正常: ${t2.length > 100 ? '✓' : '❌'}`)
    await page.screenshot({ path: `${SHOTS}m-phone-daily-bid.png` })
    // 离开牌桌
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('离开牌桌') || b.innerText.includes('返回'))
      btn?.click()
    })
    await new Promise((r) => setTimeout(r, 800))
  }

  const realErrors = errors.filter((e) => !e.includes('favicon'))
  if (realErrors.length) {
    failed = true
    console.log(`[${vp.name}] 控制台错误:`, realErrors.slice(0, 3))
  }
  await page.close()
}

await browser.close()
console.log(failed ? '\n移动端验证失败 ❌' : '\n移动端验证通过 ✅')
process.exit(failed ? 1 : 0)
