// 每日双人赛联机版浏览器冒烟：注册 → 注入 token → 每日赛页 → 开打第 1 副 → 打完 → 校验排行榜/进行中/成绩展示
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:7100'
const API = 'http://localhost:8100'
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

const rnd = Math.random().toString(36).slice(2, 8)
const nick = `冒烟牌手${rnd}`

// 直接通过 REST 注册，浏览器里注入 token 进入在线模式
const reg = await fetch(`${API}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `smoke_${rnd}`, nickname: nick, password: 'secret123' }),
}).then((r) => r.json())
if (!reg.token) throw new Error('注册失败: ' + JSON.stringify(reg))
console.log('注册成功:', reg.user.nickname)

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1366, height: 900 })
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate((t) => localStorage.setItem('bh-token', t), reg.token)
await page.goto(BASE + '/event/daily', { waitUntil: 'networkidle0', timeout: 20000 })
await new Promise((r) => setTimeout(r, 1500))

let text = await page.evaluate(() => document.body.innerText)
console.log('联机徽标:', text.includes('联机'), '| 开打按钮:', text.includes('开打本副'), '| 排行榜:', text.includes('全场总排名'))
await page.screenshot({ path: `${SHOTS}daily-online.png` })

// 开打第 1 副
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开打本副'))
  if (btn) { btn.click(); return true }
  return false
})
console.log('点击开打第 1 副:', clicked)
await new Promise((r) => setTimeout(r, 2000))
text = await page.evaluate(() => document.body.innerText)
console.log('进入牌桌:', text.includes('第 1/1 副'), '| 手牌区渲染:', text.includes('联机'))
await page.screenshot({ path: `${SHOTS}daily-game.png` })

// 自动打完：有 Pass 点 Pass，有可出牌点第一张
const t0 = Date.now()
let bids = 0, plays = 0
while (Date.now() - t0 < 150000) {
  const state = await page.evaluate(() => {
    const t = document.body.innerText
    if (/第 \d+ 副结束/.test(t)) return { done: true }
    const passBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled)
    const playable = document.querySelector('button.ring-amber-400')
    return { done: false, canBid: !!passBtn, canPlay: !!playable }
  })
  if (state.done) break
  if (state.canPlay) {
    await page.evaluate(() => document.querySelector('button.ring-amber-400')?.click())
    plays++
    await new Promise((r) => setTimeout(r, 300))
  } else if (state.canBid) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass')?.click())
    bids++
    await new Promise((r) => setTimeout(r, 300))
  } else {
    await new Promise((r) => setTimeout(r, 400))
  }
}
console.log(`牌局结束（叫牌 ${bids} 次，出牌 ${plays} 次）`)
await new Promise((r) => setTimeout(r, 800))
await page.screenshot({ path: `${SHOTS}daily-result.png` })

// 离开牌桌返回赛事页
const left = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('离开牌桌') || b.innerText.includes('返回'))
  if (btn) { btn.click(); return btn.innerText }
  return null
})
console.log('离开牌桌:', left)
await new Promise((r) => setTimeout(r, 1500))
text = await page.evaluate(() => document.body.innerText)
const hasProgress = text.includes('1/8')
const hasLive = text.includes('进行中') && text.includes(nick)
const hasContract = /第 1 副[\s\S]{0,80}(MP)/.test(text)
console.log('进度 1/8:', hasProgress, '| 进行中名单含我:', hasLive, '| 第 1 副显示成绩与 MP:', hasContract)
await page.screenshot({ path: `${SHOTS}daily-after.png` })

const realErrors = errors.filter((e) => !e.includes('favicon'))
console.log('控制台错误:', realErrors.length ? realErrors.slice(0, 5) : '无')
await browser.close()

const pass = hasProgress && hasLive && realErrors.length === 0
console.log(pass ? '\n浏览器冒烟通过 ✅' : '\n浏览器冒烟失败 ❌')
process.exit(pass ? 0 : 1)
