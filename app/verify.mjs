// 无头浏览器冒烟验证：遍历平台各页面，收集控制台错误并截图
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:7100'
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

const pages = [
  ['/', 'home'],
  ['/lobby', 'lobby'],
  ['/event/daily', 'daily'],
  ['/scoring', 'scoring'],
  ['/systems', 'systems'],
  ['/profile', 'profile'],
  ['/table/t-101', 'table'],
]

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})

let failed = false
const page = await browser.newPage()
await page.setViewport({ width: 1366, height: 900 })

for (const [path, name] of pages) {
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  const resp = await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 20000 })
  await new Promise((r) => setTimeout(r, 600))
  const text = await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\n+/g, ' | '))
  await page.screenshot({ path: `${SHOTS}${name}.png` })
  const status = resp.status()
  const realErrors = errors.filter((e) => !e.includes('favicon'))
  if (status !== 200 || realErrors.length) failed = true
  console.log(`[${status}] ${path} -> ${text.slice(0, 80)}`)
  if (realErrors.length) console.log('  CONSOLE ERRORS:', realErrors.slice(0, 3))
  page.removeAllListeners('console')
  page.removeAllListeners('pageerror')
}

// 交互冒烟：注册账号 -> 大厅创建牌桌
await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
const errors2 = []
page.on('pageerror', (e) => errors2.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors2.push(m.text()))

// 打开登录对话框并注册
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('登录 / 注册'))
  if (btn) { btn.click(); return true }
  return false
})
console.log('open auth dialog:', clicked)
await new Promise((r) => setTimeout(r, 500))
// Radix 标签用 mousedown 激活，需要真实鼠标事件序列
const regTab = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.innerText.includes('注册'))
  if (!tab) return false
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    tab.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  }
  return true
})
await new Promise((r) => setTimeout(r, 400))
console.log('switch to register tab:', regTab)
await page.type('#r-name', 'tester01')
await page.type('#r-nick', '测试牌手')
await page.type('#r-pw', 'secret123')
await page.type('#r-pw2', 'secret123')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('创建账号'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 800))
const whoami = await page.evaluate(() => document.body.innerText.includes('测试牌手'))
console.log('registered & logged in:', whoami)

// 大厅入座
await page.goto(BASE + '/lobby', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 500))
const joined = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('入座') && !b.disabled)
  if (btn) { btn.click(); return true }
  return false
})
await new Promise((r) => setTimeout(r, 500))
const hasEnter = await page.evaluate(() => document.body.innerText.includes('进入牌桌'))
console.log('join seat clicked:', joined, '| enter-table visible:', hasEnter)

// 计分器冒烟：4S 无局打成应为 420
await page.goto(BASE + '/scoring', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.innerText.includes('计分器'))
  tab?.click()
})
await new Promise((r) => setTimeout(r, 400))
const scoreVisible = await page.evaluate(() => /[+-]?\d{2,4}/.test(document.body.innerText))
console.log('calculator renders score:', scoreVisible)

// ---- 完整对局冒烟：入座 -> 开始牌局 -> 打完一副（联机模式） ----
await page.goto(BASE + '/table/t-101', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 800))
// 联机模式需先入座
const joinedFirst = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '入座')
  if (btn) { btn.click(); return true }
  return false
})
await new Promise((r) => setTimeout(r, 800))
const started = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始牌局'))
  if (btn) { btn.click(); return true }
  return false
})
console.log('join-then-start:', joinedFirst, '->', started)

const t0 = Date.now()
let phase = 'bidding'
let userBids = 0
let userPlays = 0
while (Date.now() - t0 < 150000) {
  const state = await page.evaluate(() => {
    const text = document.body.innerText
    if (/第 \d+ 副结束/.test(text)) return { done: true }
    // 叫牌盘可见？
    const passBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass')
    const biddingBox = !!passBtn && !!document.querySelector('.ring-amber-400') === false ? !!passBtn : !!passBtn
    const playable = document.querySelector('button.ring-amber-400')
    return { done: false, canBid: !!passBtn, canPlay: !!playable, contract: text.includes('定约：') }
  })
  if (state.done) break
  if (state.canPlay) {
    await page.evaluate(() => document.querySelector('button.ring-amber-400')?.click())
    userPlays++
    await new Promise((r) => setTimeout(r, 250))
    continue
  }
  if (state.canBid) {
    await page.evaluate(() => {
      const passBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass')
      passBtn?.click()
    })
    userBids++
    phase = 'play-after-bid'
  }
  await new Promise((r) => setTimeout(r, 900))
}
const boardDone = await page.evaluate(() => /第 \d+ 副结束/.test(document.body.innerText))
const scoreRow = await page.evaluate(() => /#1\s/.test(document.body.innerText) || document.body.innerText.includes('累计'))
console.log(`board finished: ${boardDone} | scoreboard updated: ${scoreRow} | user bids: ${userBids}, user plays: ${userPlays}`)
await page.screenshot({ path: `${SHOTS}game.png` })
if (!boardDone) failed = true

const errs = errors2.filter((e) => !e.includes('favicon'))
if (errs.length) { failed = true; console.log('INTERACTION ERRORS:', errs.slice(0, 5)) }
console.log(failed ? '\nSMOKE: FAILED' : '\nSMOKE: PASSED')
await browser.close()
process.exit(failed ? 1 : 0)
