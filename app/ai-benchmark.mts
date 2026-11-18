// AI 水平量化对照（v1.9.0）
// 用法：npx tsx ai-benchmark.mts [副数]
// 同一批固定种子的牌，分别让庄家方 / 防守方使用「旧规则 choosePlayBasic」与「增强版 choosePlay」，
// 比较庄家方平均赢墩数：防守越强则庄家墩数越少，庄家越强则墩数越多。
import { dealHands, type CardT } from './src/lib/cards'
import {
  chooseBid, choosePlay, choosePlayBasic, auctionOver, getContract,
  legalPlays, nextSeat, partnerOf, trickWinner,
  type AuctionEntry, type TrickPlay,
} from './src/lib/game'
import { seatPartnership, type Seat, type Suit } from './src/lib/bridge'
import { boardVul, boardDealer } from './src/lib/bridge'
import type { BiddingSystem } from './src/lib/data'

const SEATS: Seat[] = ['N', 'E', 'S', 'W']
const BOARDS = Number(process.argv[2] ?? 300)

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Strategy = 'basic' | 'enhanced'

function simulate(hands: Record<Seat, CardT[]>, system: BiddingSystem, boardNo: number,
                  declarerSide: Strategy, defense: Strategy): { decTricks: number; contract: string } | null {
  // 叫牌（统一用增强版，保证四组对照的定约完全相同）
  const auction: AuctionEntry[] = []
  let turn: Seat = boardDealer(boardNo)
  for (let i = 0; i < 40 && !auctionOver(auction); i++) {
    const call = chooseBid(hands[turn], auction, turn, system, {
      vul: boardVul(boardNo), scoring: 'mp', boardNo,
    })
    auction.push({ seat: turn, call })
    turn = nextSeat(turn)
  }
  const contract = getContract(auction)
  if (!contract) return null
  const trump: Suit | null = contract.strain === 'NT' ? null : (contract.strain as Suit)
  const declarer = contract.declarer
  const dummy = partnerOf(declarer)
  const declarerSideSeats = new Set<Seat>([declarer, dummy])

  const h: Record<Seat, CardT[]> = { N: [...hands.N], E: [...hands.E], S: [...hands.S], W: [...hands.W] }
  const played: CardT[] = []
  let lead: Seat = nextSeat(declarer)
  let decTricks = 0

  for (let t = 0; t < 13; t++) {
    const trick: TrickPlay[] = []
    let seat: Seat = lead
    for (let k = 0; k < 4; k++) {
      const useEnhanced = declarerSideSeats.has(seat) ? declarerSide === 'enhanced' : defense === 'enhanced'
      const partnerHand = declarerSideSeats.has(seat)
        ? h[seat === declarer ? dummy : declarer]
        : null
      const ctx = {
        played,
        declarer,
        strain: contract.strain,
        vul: boardVul(boardNo),
        scoring: 'mp' as const,
        tricksNS: 0, tricksEW: 0, boardNo,
        ...(partnerHand ? { partnerHand } : {}),
      }
      const card = useEnhanced
        ? choosePlay(h[seat], trick, trump, seat, ctx)
        : choosePlayBasic(h[seat], trick, trump, seat)
      // 兜底：策略必须返回合法牌，否则视为 basic 的合法最小牌
      const legal = legalPlays(h[seat], trick)
      const chosen = legal.some((c) => c.suit === card.suit && c.rank === card.rank)
        ? card
        : legal[0]
      h[seat] = h[seat].filter((c) => !(c.suit === chosen.suit && c.rank === chosen.rank))
      trick.push({ seat, card: chosen })
      played.push(chosen)
      seat = nextSeat(seat)
    }
    const winner = trickWinner(trick, trump)
    if (seatPartnership(winner) === seatPartnership(declarer)) decTricks++
    lead = winner
  }
  return { decTricks, contract: `${contract.level}${contract.strain} by ${declarer}` }
}

type Group = { name: string; declarerSide: Strategy; defense: Strategy; total: number; n: number }
const groups: Group[] = [
  { name: '双方旧规则（基线）', declarerSide: 'basic', defense: 'basic', total: 0, n: 0 },
  { name: '庄家增强 / 防守旧', declarerSide: 'enhanced', defense: 'basic', total: 0, n: 0 },
  { name: '庄家旧 / 防守增强', declarerSide: 'basic', defense: 'enhanced', total: 0, n: 0 },
  { name: '双方增强（线上）', declarerSide: 'enhanced', defense: 'enhanced', total: 0, n: 0 },
]

for (let b = 1; b <= BOARDS; b++) {
  const hands = dealHands(mulberry32(1000 + b))
  const system: BiddingSystem = b % 2 === 0 ? 'precision' : 'natural'
  for (const g of groups) {
    const r = simulate(hands, system, b, g.declarerSide, g.defense)
    if (!r) continue
    g.total += r.decTricks
    g.n++
  }
}

console.log(`\n===== AI 水平对照：${BOARDS} 副固定牌（庄家方平均赢墩数 / 13）=====`)
for (const g of groups) {
  console.log(`  ${g.name.padEnd(22)} : ${(g.total / g.n).toFixed(3)} 墩  (${g.n} 副)`)
}
const avg = (i: number) => groups[i].total / groups[i].n
const defenseGain = avg(0) - avg(2) // 防守增强后庄家少赢的墩数
const declarerGain = avg(1) - avg(0) // 庄家增强后多赢的墩数
console.log(`\n  防守增强让庄家少赢 ${defenseGain.toFixed(3)} 墩；庄家增强让庄家多赢 ${declarerGain.toFixed(3)} 墩`)
const ok = defenseGain > 0.05 && declarerGain > -0.05
console.log(`  结论：${ok ? '✓ 增强版 AI 在防守（并维持庄家水平）上确实更强' : '✘ 未体现出提升，需复盘策略'}`)
if (!ok) process.exit(1)
