// 对已部署服务器做手机视口冒烟
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE ?? 'http://192.168.0.212:8100'
const b = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})
const p = await b.newPage()
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
let failed = false
for (const [path, name] of [['/', 'deployed-home'], ['/lobby', 'deployed-lobby'], ['/table/t-104', 'deployed-table'], ['/event/daily', 'deployed-daily']]) {
  await p.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 20000 })
  await new Promise((r) => setTimeout(r, 700))
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 1) failed = true
  console.log(path, '溢出:', overflow + 'px', overflow > 1 ? '❌' : '✓')
  await p.screenshot({ path: 'shots/' + name + '.png' })
}
console.log('页面错误:', errs.length ? errs : '无')
await b.close()
process.exit(failed || errs.length ? 1 : 0)
