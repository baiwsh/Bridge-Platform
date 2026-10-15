import puppeteer from 'puppeteer-core'
const BASE = 'http://localhost:8100'
const rnd = Math.random().toString(36).slice(2, 8)
const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `v110m_${rnd}`, nickname: `移动V110`, password: 'secret123' }) }).then(r => r.json())
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
})
const p = await b.newPage()
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
await p.goto(BASE + '/', { waitUntil: 'networkidle0' })
await p.evaluate((t) => localStorage.setItem('bh-token', t), reg.token)
await p.goto(BASE + '/event/daily', { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 1000))
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText.includes('开打本副'))?.click())
await new Promise(r => setTimeout(r, 2500))
await p.screenshot({ path: 'shots/v110-phone-bidding.png' })
for (let i = 0; i < 20; i++) {
  const t = await p.evaluate(() => {
    const pb = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Pass' && !b.disabled)
    if (pb) pb.click()
    return document.body.innerText
  })
  await new Promise(r => setTimeout(r, 1100))
  if (/定约/.test(t) && !t.includes('轮到你叫牌')) break
}
await new Promise(r => setTimeout(r, 2500))
await p.screenshot({ path: 'shots/v110-phone-play.png' })
const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
console.log('手机端溢出:', ov + 'px')
await b.close()
