// Security & IMP 自检：校验 v1.7.0 新增的 IMP 换算与安全输出是否符合预期
// 用法: npx tsx imp-test.mts
import { toImp, nsImp, contractScore } from './src/lib/bridge.ts'
import { JSON_LIMIT } from './server/security.ts'

let failed = 0
const ok = (cond: boolean, label: string, extra = '') => {
  if (!cond) {
    failed++
    console.log(`  ✘ ${label}${extra ? ' — ' + extra : ''}`)
  }
}

console.log('[1/4] WBF 标准 IMP 换算表（边界取样）')
const cases: [number, number][] = [
  [0, 0], [10, 0], [20, 1], [40, 1], [50, 2], [80, 2], [90, 3], [120, 3], [130, 4], [160, 4],
  [170, 5], [210, 5], [220, 6], [260, 6], [270, 7], [310, 7], [320, 8], [360, 8], [370, 9], [420, 9],
  [430, 10], [490, 10], [500, 11], [590, 11], [600, 12], [740, 12], [750, 13], [890, 13],
  [900, 14], [1090, 14], [1100, 15], [1290, 15], [1300, 16], [1490, 16], [1500, 17], [1740, 17],
  [1750, 18], [1990, 18], [2000, 19], [2240, 19], [2250, 20], [2490, 20], [2500, 21], [2990, 21],
  [3000, 22], [3490, 22], [3500, 23], [3990, 23], [4000, 24], [99999, 24],
]
for (const [diff, want] of cases) ok(toImp(diff) === want, `toImp(${diff})`, `得到 ${toImp(diff)}，期望 ${want}`)
console.log(`  ${cases.length} 个取样点`)

console.log('[2/4] IMP 符号与单调性')
ok(nsImp(450) === 10, 'nsImp(450) = +10')
ok(nsImp(-450) === -10, 'nsImp(-450) = -10')
ok(nsImp(0) === 0, 'nsImp(0) = 0')
let mono = true
for (let d = 10; d <= 5000; d += 10) if (toImp(d) < toImp(d - 10)) mono = false
ok(mono, '换算结果单调不减')

console.log('[3/4] IMP 与复式计分联动')
// 4♠X 宕 3 无局 = -500 → 11 IMP
const r = contractScore({ level: 4, strain: 'S', doubled: 'X', declarer: 'N', tricks: 7, vul: 'none' })
ok(r.score === -500, '计分基准未变', `得到 ${r.score}`)
ok(nsImp(r.score) === -11, 'nsImp(-500) = -11')
// 3NT 打成 +1 有局 = 630 → 12 IMP
const r2 = contractScore({ level: 3, strain: 'NT', doubled: 'none', declarer: 'S', tricks: 10, vul: 'both' })
ok(r2.score === 630, '3NT+1 有局 = 630', `得到 ${r2.score}`)
ok(nsImp(r2.score) === 12, 'nsImp(630) = 12')

console.log('[4/4] 安全配置')
ok(JSON_LIMIT === '32kb' || /^\d+kb$/.test(JSON_LIMIT), '请求体上限已配置', JSON_LIMIT)

console.log()
console.log(failed === 0 ? '全部通过 ✔' : `${failed} 项未通过 ✘`)
process.exit(failed === 0 ? 0 : 1)
