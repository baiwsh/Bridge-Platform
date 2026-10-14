// 桥牌核心类型与双人赛计分引擎（复式计分 + 比赛分 Matchpoints）

export type Strain = 'C' | 'D' | 'H' | 'S' | 'NT'
export type Doubled = 'none' | 'X' | 'XX'
export type Seat = 'N' | 'E' | 'S' | 'W'
export type Vul = 'none' | 'NS' | 'EW' | 'both'

export const STRAINS: Strain[] = ['C', 'D', 'H', 'S', 'NT']
export const STRAIN_LABEL: Record<Strain, string> = {
  C: '♣',
  D: '♦',
  H: '♥',
  S: '♠',
  NT: 'NT',
}
export const STRAIN_NAME: Record<Strain, string> = {
  C: '梅花',
  D: '方块',
  H: '红桃',
  S: '黑桃',
  NT: '无将',
}

export function seatPartnership(seat: Seat): 'NS' | 'EW' {
  return seat === 'N' || seat === 'S' ? 'NS' : 'EW'
}

export function isVulnerable(vul: Vul, side: 'NS' | 'EW'): boolean {
  return vul === 'both' || vul === side
}

export interface ContractInput {
  level: number // 1..7
  strain: Strain
  doubled: Doubled
  declarer: Seat
  /** 庄家实际取得的墩数 0..13 */
  tricks: number
  vul: Vul
}

export interface ContractResult {
  /** 庄家方得分（正为得分，负为宕墩罚分） */
  score: number
  made: boolean
  overtricks: number
  undertricks: number
  trickPoints: number
  isGame: boolean
  isSlam: boolean
  breakdown: string[]
}

const MINOR: Strain[] = ['C', 'D']

export function trickValue(strain: Strain): number {
  if (strain === 'NT') return 30
  return MINOR.includes(strain) ? 20 : 30
}

/** 复式桥牌定约计分 */
export function contractScore(c: ContractInput): ContractResult {
  const side = seatPartnership(c.declarer)
  const vul = isVulnerable(c.vul, side)
  const need = 6 + c.level
  const made = c.tricks >= need
  const mult = c.doubled === 'XX' ? 4 : c.doubled === 'X' ? 2 : 1
  const breakdown: string[] = []

  if (made) {
    const over = c.tricks - need
    // 墩分
    let trickPoints: number
    if (c.strain === 'NT') {
      trickPoints = (30 * c.level + 10) * mult
    } else {
      trickPoints = trickValue(c.strain) * c.level * mult
    }
    breakdown.push(
      `墩分：${STRAIN_LABEL[c.strain]} ${c.level} 阶 = ${c.strain === 'NT' ? `30×${c.level}+10` : `${trickValue(c.strain)}×${c.level}`}${mult > 1 ? ` ×${mult}（${c.doubled === 'X' ? '加倍' : '再加倍'}）` : ''} = ${trickPoints}`
    )

    const isGame = trickPoints >= 100
    const isSmallSlam = c.level === 6
    const isGrand = c.level === 7

    let bonus = 0
    if (isGame) {
      const g = vul ? 500 : 300
      bonus += g
      breakdown.push(`成局奖分：${g}（${vul ? '有局' : '无局'}）`)
    } else {
      bonus += 50
      breakdown.push('部分定约奖分：50')
    }
    if (isSmallSlam) {
      const s = vul ? 750 : 500
      bonus += s
      breakdown.push(`小满贯奖分：${s}`)
    }
    if (isGrand) {
      const g = vul ? 1500 : 1000
      bonus += g
      breakdown.push(`大满贯奖分：${g}`)
    }
    if (c.doubled !== 'none') {
      const insult = c.doubled === 'X' ? 50 : 100
      bonus += insult
      breakdown.push(`完成${c.doubled === 'X' ? '加倍' : '再加倍'}定约奖分：${insult}`)
    }

    // 超墩
    let overScore = 0
    if (over > 0) {
      if (c.doubled === 'none') {
        overScore = over * trickValue(c.strain)
        breakdown.push(`超墩：${over} 墩 × ${trickValue(c.strain)} = ${overScore}`)
      } else {
        const each = (vul ? 200 : 100) * (c.doubled === 'XX' ? 2 : 1)
        overScore = over * each
        breakdown.push(`超墩（${c.doubled === 'X' ? '加倍' : '再加倍'}）：${over} 墩 × ${each} = ${overScore}`)
      }
    }

    return {
      score: trickPoints + bonus + overScore,
      made: true,
      overtricks: over,
      undertricks: 0,
      trickPoints,
      isGame,
      isSlam: isSmallSlam || isGrand,
      breakdown,
    }
  }

  // 宕墩
  const down = need - c.tricks
  let penalty = 0
  if (c.doubled === 'none') {
    penalty = down * (vul ? 100 : 50)
    breakdown.push(`宕 ${down} 墩（未加倍，${vul ? '有局 100/墩' : '无局 50/墩'}）= ${penalty}`)
  } else {
    const base = c.doubled === 'XX' ? 2 : 1
    if (vul) {
      penalty = (200 + 300 * (down - 1)) * base
      breakdown.push(`宕 ${down} 墩（${c.doubled === 'X' ? '加倍' : '再加倍'}，有局 200 起，其后 300/墩）= ${penalty}`)
    } else {
      const ladder = down === 1 ? 100 : down === 2 ? 300 : 500 + 300 * (down - 3)
      penalty = ladder * base
      breakdown.push(`宕 ${down} 墩（${c.doubled === 'X' ? '加倍' : '再加倍'}，无局 100/300/500，其后 300/墩）= ${penalty}`)
    }
  }
  return {
    score: -penalty,
    made: false,
    overtricks: 0,
    undertricks: down,
    trickPoints: 0,
    isGame: false,
    isSlam: false,
    breakdown,
  }
}

/** 描述定约，如 4♠X */
export function contractLabel(level: number, strain: Strain, doubled: Doubled): string {
  return `${level}${STRAIN_LABEL[strain]}${doubled === 'none' ? '' : doubled}`
}

/** 结果串，如 "4♠X N +1" */
export function describeContract(c: ContractInput): string {
  const need = 6 + c.level
  const diff = c.tricks - need
  const res = diff === 0 ? '=' : diff > 0 ? `+${diff}` : `${diff}`
  return `${contractLabel(c.level, c.strain, c.doubled)} ${c.declarer} ${res}`
}

// ---------------------------------------------------------------------------
// 双人赛比赛分（Matchpoints）

export interface PairResult {
  pairId: string
  name: string
  /** 该对选手（固定为南北方向计分视角）在一副牌上的得分 */
  nsScore: number
}

export interface MatchpointResult extends PairResult {
  mp: number
  maxMp: number
  pct: number
  rank: number
}

/**
 * 经典比赛分：与每一对比较，胜 2 分、平 1 分、负 0 分。
 * direction = NS：直接比较 nsScore；EW：比较反向分。
 */
export function matchpoints<T extends PairResult>(results: T[], direction: 'NS' | 'EW' = 'NS'): (MatchpointResult & T)[] {
  const n = results.length
  const out = results.map((r) => {
    const mine = direction === 'NS' ? r.nsScore : -r.nsScore
    let mp = 0
    for (const o of results) {
      if (o === r) continue
      const theirs = direction === 'NS' ? o.nsScore : -o.nsScore
      if (mine > theirs) mp += 2
      else if (mine === theirs) mp += 1
    }
    const maxMp = 2 * (n - 1)
    return { ...r, mp, maxMp, pct: maxMp > 0 ? (mp / maxMp) * 100 : 0, rank: 0 }
  })
  const sorted = [...out].sort((a, b) => b.mp - a.mp || b.nsScore - a.nsScore)
  let lastMp = -1
  let lastScore = -Infinity
  let lastRank = 0
  sorted.forEach((r, i) => {
    if (r.mp !== lastMp || r.nsScore !== lastScore) {
      lastRank = i + 1
      lastMp = r.mp
      lastScore = r.nsScore
    }
    r.rank = lastRank
  })
  return sorted
}

/** 局况按标准 16 副轮换 */
export function boardVul(board: number): Vul {
  const cycle: Vul[] = ['none', 'NS', 'EW', 'both', 'NS', 'EW', 'both', 'none', 'EW', 'both', 'none', 'NS', 'both', 'none', 'NS', 'EW']
  return cycle[(board - 1) % 16]
}

export function boardDealer(board: number): Seat {
  const seats: Seat[] = ['N', 'E', 'S', 'W']
  return seats[(board - 1) % 4]
}

export const VUL_LABEL: Record<Vul, string> = {
  none: '双无',
  NS: '南北有局',
  EW: '东西有局',
  both: '双有',
}
