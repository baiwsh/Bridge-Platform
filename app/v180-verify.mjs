// v1.8.0 三项改动的浏览器端验收：
//   1) 首攻前明手不摊牌  2) 收墩后延迟 3 秒  3) 牌面尺寸与字号放大 50%
// 用法（需先启动后端 :8100 与 vite :7100）: node v180-verify.mjs
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'

const BASE = process.env.BASE ?? 'http://localhost:7100'
const API = process.env.API ?? 'http://localhost:8100'
const WS = process.env.WS ?? 'ws://localhost:8100'
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

let failed = false
const ok = (cond, label, extra = '') => {
  if (!cond) failed = true
  console.log(`  ${cond ? '✓' : '✘'} ${label}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 每个会话注册独立账号，避免上一局的 watch 残留影响新会话 */
async function newUser() {
  const r = Math.random().toString(36).slice(2, 8)
  const u = await fetch(`${API}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `v180_${r}`, nickname: `验收${r}`, password: 'secret123' }),
  }).then((x) => x.json())
  if (!u.token) throw new Error('注册失败: ' + JSON.stringify(u))
  return u.token
}

/** 用 WebSocket 建桌 → 入座 → 开牌，返回 tableId（避开 UI 点击的不确定性） */
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
        setTimeout(() => {
          ws.send(JSON.stringify({ t: 'start' }))
          clearTimeout(timer)
          ws.close()
          resolve(t.id)
        }, 600)
      }
    })
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'create', name, system: 'precision', scoring: 'mp', boards: 8, kind: 'bots' }))
    })
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

// 页面内探针：明牌数、明手明牌数、墩上牌数、牌尺寸
// 注意：叫品小卡条也是 button 且含花色符号，必须用 rounded-md 识别出真正的「牌」
const PROBE = () => {
  const isCard = (b) => (b.className || '').includes('rounded-md')
  const suit = (b) => /[♠♥♦♣]/.test(b.textContent || '')
  const cardBtn = (b) => isCard(b) && suit(b)
  const suitBtns = [...document.querySelectorAll('button')].filter(cardBtn)
  const dummyLabel = [...document.querySelectorAll('span')].find((s) => (s.textContent || '').includes('（明手）'))
  const seatRoot = dummyLabel ? dummyLabel.closest('div.absolute') : null
  const dummyFaceUp = seatRoot ? [...seatRoot.querySelectorAll('button')].filter(cardBtn).length : -1
  const center = document.querySelector('div[class*="w-[264px]"], div[class*="w-[336px]"]')
  const trickCount = center ? [...center.querySelectorAll('button')].filter(cardBtn).length : -1
  const cardEl = suitBtns[0]
  const rect = cardEl ? cardEl.getBoundingClientRect() : null
  return {
    faceUpTotal: suitBtns.length,
    dummyFaceUp,
    dummyIsMe: seatRoot ? /bottom-/.test(seatRoot.className || '') : false,
    trickCount,
    cardW: rect ? Math.round(rect.width) : null,
    cardH: rect ? Math.round(rect.height) : null,
    fontSize: cardEl ? Math.round(parseFloat(getComputedStyle(cardEl).fontSize)) : null,
    text: document.body.innerText,
  }
}

const clickPlayable = (page) =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.className || '').includes('ring-amber-400'))
    if (b) { b.click(); return true }
    return false
  })

/**
 * 叫一个高阶定约（7♣ 优先，逐级降级），让叫牌迅速结束。
 * 注意不能一直 Pass——四家全 Pass 会流局重发，陷入死循环。
 */
async function makeBid(page) {
  for (const lv of ['7', '6', '5', '4', '3', '2', '1']) {
    const pickedLevel = await page.evaluate((l) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === l && !x.disabled)
      if (b) { b.click(); return true }
      return false
    }, lv)
    if (!pickedLevel) continue
    await sleep(150)
    for (const s of ['♣', '♦', '♥', '♠', 'NT']) {
      const done = await page.evaluate((st) => {
        const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === st && !x.disabled)
        if (b) { b.click(); return true }
        return false
      }, s)
      if (done) return true
    }
  }
  return false
}

const clickPass = (page) =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Pass' && !x.disabled)
    if (b) { b.click(); return true }
    return false
  })

/** 推进叫牌直到进入打牌阶段 */
async function advanceToPlay(page) {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => document.body.innerText)
    if (t.includes('定约')) return true
    if (t.includes('轮到你叫牌')) {
      // 叫不到更高定约时（AI 已封顶）改 Pass，避免卡死
      if (!(await makeBid(page))) await clickPass(page)
    }
    await sleep(300)
  }
  return false
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--no-proxy-server'],
})
const allErrors = []

async function session(vp, tableTag) {
  const page = await browser.newPage()
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.width < 640, hasTouch: vp.width < 640 })
  page.on('pageerror', (e) => allErrors.push('PAGEERROR: ' + e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 })
  const token = await newUser()
  await page.evaluate((t) => localStorage.setItem('bh-token', t), token)
  const tableId = await openTable(token, `验收-${tableTag}-${Math.random().toString(36).slice(2, 6)}`)
  await page.goto(`${BASE}/table/${tableId}`, { waitUntil: 'networkidle0', timeout: 30000 })
  await sleep(1500)
  if (!(await advanceToPlay(page))) throw new Error('等待打牌阶段超时')
  return page
}

// ---------------- 1 & 3：明手摊牌时机 + 牌面尺寸 ----------------
for (const vp of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  console.log(`\n===== 视口 ${vp.name} ${vp.width}x${vp.height} =====`)
  let page
  try {
    page = await session(vp, vp.name)
    const before = await page.evaluate(PROBE)
    console.log(`  首攻前: 明牌总数=${before.faceUpTotal} 明手明牌=${before.dummyFaceUp} 墩上=${before.trickCount} 我是明手=${before.dummyIsMe}`)
    await page.screenshot({ path: `${SHOTS}v180-${vp.name}-1-before-lead.png` })
    ok(before.trickCount === 0, '首攻前墩上无牌')
    if (before.dummyIsMe) console.log('  （本局自己是明手，摊牌检测不适用，跳过）')
    else ok(before.dummyFaceUp === 0, '首攻前明手未摊牌（明牌 0 张）', `实测 ${before.dummyFaceUp}`)
    ok(before.faceUpTotal === 13, "首攻前只有自己手牌是明的（13 张）", `实测 ${before.faceUpTotal}`)

    // 等首攻（轮到我就出牌）
    let after = null
    const t0 = Date.now()
    while (Date.now() - t0 < 45000) {
      after = await page.evaluate(PROBE)
      if (after.text.includes('轮到你') && after.text.includes('出牌')) await clickPlayable(page)
      if (after.trickCount >= 1) break
      await sleep(250)
    }
    if (!after || after.trickCount < 1) throw new Error('等待首攻超时')
    console.log(`  首攻后: 明牌总数=${after.faceUpTotal} 明手明牌=${after.dummyFaceUp} 墩上=${after.trickCount}`)
    await page.screenshot({ path: `${SHOTS}v180-${vp.name}-2-after-lead.png` })
    ok(after.dummyFaceUp === 13, '首攻后明手已摊牌（13 张明牌）', `实测 ${after.dummyFaceUp}`)

    console.log(`  牌尺寸: ${after.cardW}×${after.cardH}px, 字号 ${after.fontSize}px`)
    const wantW = vp.width < 640 ? 54 : 60
    const wantH = vp.width < 640 ? 72 : 84
    const wantFs = vp.width < 640 ? 18 : 21
    ok(Math.abs(after.cardW - wantW) <= 2, `牌宽 ≈ ${wantW}px（原 36/40 的 1.5 倍）`, `实测 ${after.cardW}`)
    ok(Math.abs(after.cardH - wantH) <= 2, `牌高 ≈ ${wantH}px（原 48/56 的 1.5 倍）`, `实测 ${after.cardH}`)
    ok(Math.abs(after.fontSize - wantFs) <= 2, `字号 ≈ ${wantFs}px（原 12/14 的 1.5 倍）`, `实测 ${after.fontSize}`)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ok(overflow <= 1, '页面无横向溢出', `${overflow}px`)
    await page.close()
  } catch (e) {
    failed = true
    console.log(`  ✘ ${vp.name} 失败: ${e.message}`)
    try { await page?.close() } catch {}
  }
}

// ---------------- 2：收墩延迟 ----------------
console.log('\n===== 收墩延迟（应约 3000ms，原为 1100ms）=====')
try {
  const page = await session({ name: "desktop", width: 1280, height: 900 }, "clear")
  let tFull = 0
  let gap = null
  const deadline = Date.now() + 120000
  while (Date.now() < deadline && gap === null) {
    const p = await page.evaluate(PROBE)
    if (p.text.includes('轮到你') && p.text.includes('出牌')) await clickPlayable(page)
    if (p.trickCount === 4 && !tFull) { tFull = Date.now(); console.log('  观察到第 1 墩收齐，开始计时') }
    if (tFull && p.trickCount === 0) gap = Date.now() - tFull
    await sleep(120)
  }
  if (gap === null) { failed = true; console.log('  ✘ 未观察到完整收墩') }
  else {
    console.log(`  第 1 墩收齐 → 清台: ${gap}ms`)
    ok(gap >= 2600 && gap <= 3800, '收墩后延迟约 3 秒', `实测 ${gap}ms`)
  }
  await page.close()
} catch (e) {
  failed = true
  console.log(`  ✘ 收墩延迟检测失败: ${e.message}`)
}

const real = allErrors.filter((e) => !e.includes('favicon'))
if (real.length) { failed = true; console.log('\n控制台错误:', real.slice(0, 5)) }
console.log(`\n截图目录: ${SHOTS}`)
console.log(failed ? '结论：存在未通过项 ✘' : '结论：全部通过 ✔')
await browser.close()
process.exit(failed ? 1 : 0)
