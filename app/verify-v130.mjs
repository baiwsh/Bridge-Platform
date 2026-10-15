// V1.3.0 「旁观者接管 AI 牌手」专项验证：
//  1) 对局中旁观者可接管纯 AI 座位 → 立即看到自己 13 张手牌，其他玩家视角该座位显示其昵称
//  2) 真人断线托管（managed）座位不可接管：旁观者看不到该座位的接管按钮
//  3) 大厅阶段（未开局）满员 AI 桌也可接管空出座位
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8100'
const TABLE = process.env.TABLE_ID ?? 't-102' // 精确之道：3 bot + 1 空位
const TABLE_FULL = process.env.TABLE_FULL_ID ?? 't-103' // 四人成行：4 bot 满员
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

let failed = false
const check = (name, ok) => { console.log(`${ok ? '✓' : '❌'} ${name}`); if (!ok) failed = true }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function newPage(token) {
  const p = await browser.newPage()
  await p.setViewport({ width: 1366, height: 900 })
  p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await p.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
  await p.evaluate((t) => localStorage.setItem('bh-token', t), token)
  return p
}

const countTakeoverBtns = (page) =>
  page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === '接管').length)

// ---------- A 入座 t-102 并开始 ----------
const A = await reg('v130a')
const B = await reg('v130b')
const pa = await newPage(A.token)
await pa.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
await sleep(1200)
await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '入座')?.click())
await sleep(800)
await pa.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始牌局'))?.click())
await sleep(1500)
check('A 开始牌局进入叫牌阶段', (await pa.evaluate(() => document.body.innerText)).includes('叫牌过程'))

// ---------- 1) B 旁观 → 接管一个 AI 座位 ----------
const pb = await newPage(B.token)
await pb.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
await sleep(2000)
const spect = await pb.evaluate(() => document.body.innerText)
check('B 旁观中且能看到接管按钮', spect.includes('旁观中') && (await countTakeoverBtns(pb)) >= 3)
await pb.screenshot({ path: SHOTS + 'v130-spectate-takeover.png' })

// 点击第一个「接管」按钮（对局中座位名牌上的）
await pb.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '接管')?.click())
await sleep(1500)
const afterTake = await pb.evaluate(() => document.body.innerText)
check('B 接管后不再是旁观者', !afterTake.includes('旁观中'))
// B 应看到自己 13 张手牌（角标纵向堆叠，innerText 形如 "K\n♠"）
const myCards = await pb.evaluate(
  () => [...document.querySelectorAll('button')].filter((b) => /^([2-9]|10|J|Q|K|A)\n[♠♥♦♣]/.test(b.innerText)).length
)
console.log('  B 可见手牌数:', myCards)
check('B 接管后看到自己 13 张手牌', myCards === 13)
await pb.screenshot({ path: SHOTS + 'v130-took-over.png' })

// A 视角：被接管的座位应显示 B 的昵称
await sleep(800)
check('A 视角该座位显示 B 昵称', (await pa.evaluate(() => document.body.innerText)).includes(B.user.nickname))

// ---------- 2) A 断线 → 其座位托管，C 旁观时该座位无接管按钮 ----------
await pa.close() // A 断线 → managed
await sleep(1500)
const C = await reg('v130c')
const pc = await newPage(C.token)
await pc.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
await sleep(2000)
const cText = await pc.evaluate(() => document.body.innerText)
check('C 看到托管标识', cText.includes('托管'))
// 纯 bot 剩 2 个（3 bot - B 接管 1 个），A 的座位是 managed → 接管按钮应恰好 2 个
const btnCount = await countTakeoverBtns(pc)
console.log('  C 看到的接管按钮数:', btnCount)
check('C 对托管座位无接管按钮（仅 2 个纯 AI 可接管）', btnCount === 2)
await pc.screenshot({ path: SHOTS + 'v130-managed-no-takeover.png' })

// ---------- 3) D 旁观满员 AI 桌（大厅阶段）→ 接管入座 ----------
const D = await reg('v130d')
const pd = await newPage(D.token)
await pd.goto(`${BASE}/table/${TABLE_FULL}`, { waitUntil: 'networkidle0' })
await sleep(2000)
const dText = await pd.evaluate(() => document.body.innerText)
check('D 看到满员 AI 桌大厅', dText.includes('四人成行') || dText.includes('AI'))
const dBtnCount = await countTakeoverBtns(pd)
console.log('  D 在大厅看到的接管按钮数:', dBtnCount)
check('D 在大厅阶段看到 4 个 AI 座位的接管按钮', dBtnCount === 4)
await pd.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '接管')?.click())
await sleep(1500)
const dAfter = await pd.evaluate(() => document.body.innerText)
check('D 接管后入座成功（出现开始牌局按钮）', dAfter.includes('开始牌局'))
await pd.screenshot({ path: SHOTS + 'v130-lobby-takeover.png' })

await browser.close()
console.log(failed ? '\nV1.3 验证失败 ❌' : '\nV1.3 验证通过 ✅')
process.exit(failed ? 1 : 0)
