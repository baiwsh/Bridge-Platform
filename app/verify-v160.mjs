// V1.6.0 三功能专项验证：
//  1) 点击叫品（面板格子/牌前卡条）弹出该体系下的参考含义
//  2) AI 同伴做庄时，明手真人可「代打同伴」：庄家手牌翻开、可替庄家/明手出牌、可交还
//  3) 每副打完可「收起看牌」回顾四家发牌，再「查看结果」/「下一副」
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8100'
const TABLE = process.env.TABLE_ID ?? 't-102' // 精确之道：3 AI + 1 空位，8 副
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

let failed = false
const check = (name, ok) => { console.log(`${ok ? '✓' : '❌'} ${name}`); if (!ok) failed = true }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rnd = Math.random().toString(36).slice(2, 8)
const A = await fetch(`${BASE}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `v160_${rnd}`, nickname: `v160${rnd}`, password: 'secret123' }),
}).then((r) => r.json())
if (!A.token) throw new Error('注册失败')

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})
const p = await browser.newPage()
await p.setViewport({ width: 1366, height: 900 })
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await p.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
await p.evaluate((t) => localStorage.setItem('bh-token', t), A.token)
await p.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
await sleep(1200)
await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '入座')?.click())
await sleep(800)
await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始牌局'))?.click())
await sleep(1500)
check('进入叫牌阶段', (await p.evaluate(() => document.body.innerText)).includes('叫牌过程'))

// ---------- 功能1：点击叫品查看体系含义 ----------
let meaningBtn = false
for (let i = 0; i < 20; i++) {
  meaningBtn = await p.evaluate(() => !!document.querySelector('button[title="查看叫品含义"]'))
  if (meaningBtn) break
  await sleep(400)
}
check('叫牌中出现可点击的叫品', meaningBtn)
if (meaningBtn) {
  await p.evaluate(() => document.querySelector('button[title="查看叫品含义"]')?.click())
  await sleep(500)
  const t1 = await p.evaluate(() => document.body.innerText)
  check('弹出叫品含义卡（精确制体系卡）', t1.includes('参考含义') && t1.includes('精确制体系卡'))
  await p.screenshot({ path: SHOTS + 'v160-call-meaning.png' })
  // 点空白处关闭
  await p.evaluate(() => document.querySelector('.absolute.inset-0.z-30')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await sleep(400)
  check('点空白关闭含义卡', !(await p.evaluate(() => document.body.innerText)).includes('参考含义'))
}

// ---------- 自动 driver：全程替真人做最简决策 ----------
let reviewDone = false
let proxyDone = false
let boardGuard = 0
let iter = 0
const deadline = Date.now() + 4 * 60 * 1000

while (Date.now() < deadline && !(reviewDone && proxyDone)) {
  const state = await p.evaluate(() => {
    const t = document.body.innerText
    const playable = [...document.querySelectorAll('button.ring-amber-400')].filter((b) => !b.disabled)
    return {
      myBid: t.includes('轮到你叫牌'),
      hasResult: t.includes('收起看牌'),
      reviewing: t.includes('查看结果') && !t.includes('收起看牌'),
      canProxy: t.includes('代打同伴'),
      proxyOn: t.includes('交还 AI 出牌'),
      gameOver: t.includes('再来一局'),
      playable: playable.length,
      // 代打判定：可出牌且最上方的可出牌在屏幕上半部（庄家=顶部同伴的牌）
      proxyPlayableTop: playable.some((b) => b.getBoundingClientRect().top < window.innerHeight * 0.45),
      phaseHint: t.includes('叫牌过程') ? 'bidding' : t.includes('副结束') ? 'scored' : 'play?',
    }
  })
  if (++iter % 10 === 1) console.log('  ·driver', JSON.stringify(state))

  if (state.myBid) {
    // 跳过牌前卡条按钮（title=查看叫品含义），只点叫牌盘里的 Pass
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pass' && !b.disabled && b.title !== '查看叫品含义')?.click())
    await sleep(300)
    continue
  }

  // 功能3：本副打完 → 收起看牌 → 回顾 → 查看结果
  if (state.hasResult && !reviewDone) {
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('收起看牌'))?.click())
    await sleep(600)
    const t2 = await p.evaluate(() => document.body.innerText)
    const faceUpCount = await p.evaluate(
      () => [...document.querySelectorAll('button, div')].filter((el) => el.className.includes('bg-white') && el.className.includes('rounded-md') && el.querySelector('span')).length
    )
    check('收起结果卡后出现「查看结果」操作条', t2.includes('查看结果') && !t2.includes('收起看牌'))
    check('回顾时四家发牌全部亮出（>=40 张明牌）', faceUpCount >= 40)
    await p.screenshot({ path: SHOTS + 'v160-review-hands.png' })
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '查看结果')?.click())
    await sleep(500)
    check('点「查看结果」结果卡恢复', (await p.evaluate(() => document.body.innerText)).includes('收起看牌'))
    reviewDone = true
    continue
  }

  // 功能2：打牌阶段出现「代打同伴」→ 开启 → 验证可出同伴（庄家）的牌 → 交还
  if (state.canProxy && !state.proxyOn && !proxyDone) {
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('代打同伴'))?.click())
    await sleep(600)
    const on = await p.evaluate(() => document.body.innerText.includes('交还 AI 出牌'))
    check('开启代打：按钮切换为「交还 AI 出牌」', on)
    // 等轮到代打方出牌（庄家或明手），断言上半屏出现可出的牌（庄家的牌）
    let topPlay = false
    for (let i = 0; i < 40; i++) {
      const s = await p.evaluate(() => {
        const playable = [...document.querySelectorAll('button.ring-amber-400')].filter((b) => !b.disabled)
        return { n: playable.length, top: playable.some((b) => b.getBoundingClientRect().top < window.innerHeight * 0.45) }
      })
      if (s.top) { topPlay = true; break }
      // 明手（自己）出牌时顺手出一张推进
      if (s.n > 0) await p.evaluate(() => document.querySelector('button.ring-amber-400:not([disabled])')?.click())
      await sleep(400)
    }
    check('代打后可出顶部同伴（AI 庄家）的牌', topPlay)
    await p.screenshot({ path: SHOTS + 'v160-proxy-play.png' })
    if (topPlay) {
      await p.evaluate(() => {
        const playable = [...document.querySelectorAll('button.ring-amber-400')].filter((b) => !b.disabled)
        playable.find((b) => b.getBoundingClientRect().top < window.innerHeight * 0.45)?.click()
      })
      await sleep(400)
    }
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('交还 AI 出牌'))?.click())
    await sleep(500)
    check('交还后 AI 恢复自动出牌', !(await p.evaluate(() => document.body.innerText)).includes('交还 AI 出牌'))
    proxyDone = true
    continue
  }

  // 普通出牌
  if (state.playable > 0) {
    await p.evaluate(() => document.querySelector('button.ring-amber-400:not([disabled])')?.click())
    await sleep(300)
    continue
  }

  // 进入下一副 / 再来一局
  if (state.hasResult || state.gameOver) {
    boardGuard++
    if (boardGuard > 12) break
    await p.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      ;(btns.find((b) => b.innerText.includes('下一副')) ?? btns.find((b) => b.innerText.includes('再来一局')))?.click()
    })
    await sleep(800)
    continue
  }
  await sleep(400)
}

check('功能3 回顾本副验证完成', reviewDone)
check('功能2 代打 AI 同伴验证完成', proxyDone)
await p.screenshot({ path: SHOTS + 'v160-final.png' })

await browser.close()
console.log(failed ? '\nV1.6.0 验证失败 ❌' : '\nV1.6.0 验证通过 ✅')
process.exit(failed ? 1 : 0)
