// V1.5.1 「手机端叫牌面板收起」专项验证：
//  1) 手机视口：叫牌过程默认收起为一行摘要条，完整面板不显示
//  2) 浮层不遮挡顶部同伴的牌（几何断言：浮层顶边在同伴牌区下方）
//  3) 点摘要条可展开/收起完整面板
//  4) 桌面视口回归：完整面板仍直接显示
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
  body: JSON.stringify({ username: `v151_${rnd}`, nickname: `v151${rnd}`, password: 'secret123' }),
}).then((r) => r.json())
if (!A.token) throw new Error('注册失败')

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})

async function setupPage(width, height) {
  const p = await browser.newPage()
  await p.setViewport({ width, height })
  p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await p.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 })
  await p.evaluate((t) => localStorage.setItem('bh-token', t), A.token)
  await p.goto(`${BASE}/table/${TABLE}`, { waitUntil: 'networkidle0' })
  await sleep(1200)
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '入座')?.click())
  await sleep(800)
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始牌局'))?.click())
  await sleep(1500)
  return p
}

async function waitMyTurn(p) {
  for (let i = 0; i < 30; i++) {
    const t = await p.evaluate(() => document.body.innerText)
    if (t.includes('轮到你叫牌')) return true
    if (!t.includes('叫牌过程')) return false
    await sleep(500)
  }
  return false
}

// ---------- 手机视口 390x844 ----------
const pm = await setupPage(390, 844)
check('手机端进入叫牌且轮到真人', await waitMyTurn(pm))

const mob = await pm.evaluate(() => {
  const overlay = [...document.querySelectorAll('div')].find((d) => d.className.includes('inset-x-0') && d.className.includes('bottom-[96px]'))
  const table = [...document.querySelectorAll('div')].find((d) => d.className.includes('from-emerald-700'))
  const chip = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('叫牌过程') && b.innerText.includes('展开'))
  // 完整面板特征：面板里的「北东南西」表头格子
  const panelVisible = !![...document.querySelectorAll('*')].find(
    (e) => e.children.length === 0 && e.textContent.trim() === '叫牌过程' && e.offsetParent !== null
  )
  if (!overlay || !table) return null
  return {
    chipExists: !!chip,
    chipText: chip ? chip.innerText.replace(/\n/g, ' ') : null,
    panelVisible,
    overlayTop: Math.round(overlay.getBoundingClientRect().top - table.getBoundingClientRect().top),
    tableHeight: Math.round(table.getBoundingClientRect().height),
  }
})
console.log('  手机端:', JSON.stringify(mob))
check('手机端摘要条存在', !!mob && mob.chipExists)
check('手机端完整面板默认隐藏', !!mob && !mob.panelVisible)
check('浮层不遮挡同伴牌区（顶边低于同伴区）', !!mob && mob.overlayTop >= 150)
await pm.screenshot({ path: SHOTS + 'v151-mobile-collapsed.png' })

// ---------- 展开 / 收起 ----------
if (mob && mob.chipExists) {
  await pm.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('叫牌过程') && b.innerText.includes('展开'))?.click())
  await sleep(500)
  const open = await pm.evaluate(() => !![...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === '叫牌过程' && e.offsetParent !== null))
  check('点摘要条展开完整面板', open)
  await pm.screenshot({ path: SHOTS + 'v151-mobile-expanded.png' })
  await pm.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('叫牌过程') && b.innerText.includes('收起'))?.click())
  await sleep(500)
  const closed = await pm.evaluate(() => ![...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === '叫牌过程' && e.offsetParent !== null))
  check('再点收起面板', closed)
}

// ---------- 桌面视口回归 ----------
const pd = await setupPage(1366, 900)
check('桌面端进入叫牌且轮到真人', await waitMyTurn(pd))
const deskPanel = await pd.evaluate(() => !![...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === '叫牌过程' && e.offsetParent !== null))
check('桌面端完整面板直接显示', deskPanel)
await pd.screenshot({ path: SHOTS + 'v151-desktop.png' })

await browser.close()
console.log(failed ? '\nV1.5.1 验证失败 ❌' : '\nV1.5.1 验证通过 ✅')
process.exit(failed ? 1 : 0)
