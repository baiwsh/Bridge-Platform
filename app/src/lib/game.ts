import type { Seat, Strain, Doubled } from './bridge'
import { seatPartnership } from './bridge'
import {
  type CardT,
  type Suit,
  evalHand,
  suitCards,
  suitCount,
  longestSuit,
} from './cards'
import type { BiddingSystem } from './data'

// ---------------------------------------------------------------------------
// 叫牌（拍卖）逻辑

export type Call =
  | { type: 'bid'; level: number; strain: Strain }
  | { type: 'pass' }
  | { type: 'X' }
  | { type: 'XX' }

export interface AuctionEntry {
  seat: Seat
  call: Call
}

export const STRAIN_ORDER: Strain[] = ['C', 'D', 'H', 'S', 'NT']

export function nextSeat(s: Seat): Seat {
  return { N: 'E', E: 'S', S: 'W', W: 'N' }[s] as Seat
}

export function partnerOf(s: Seat): Seat {
  return { N: 'S', S: 'N', E: 'W', W: 'E' }[s] as Seat
}

function bidRank(level: number, strain: Strain): number {
  return level * 5 + STRAIN_ORDER.indexOf(strain)
}

export function lastBid(auction: AuctionEntry[]): AuctionEntry | null {
  for (let i = auction.length - 1; i >= 0; i--) {
    if (auction[i].call.type === 'bid') return auction[i]
  }
  return null
}

/** 当前可叫的最小阶数约束与加倍权限 */
export function callRules(auction: AuctionEntry[], seat: Seat): {
  minBidRank: number
  canX: boolean
  canXX: boolean
} {
  const lb = lastBid(auction)
  let canX = false
  let canXX = false
  if (lb) {
    const doubled = isDoubled(auction)
    if (!doubled.x && !doubled.xx && seatPartnership(seat) !== seatPartnership(lb.seat)) canX = true
    if (doubled.x && !doubled.xx && seatPartnership(seat) === seatPartnership(lb.seat)) canXX = true
  }
  return { minBidRank: lb && lb.call.type === 'bid' ? bidRank(lb.call.level, lb.call.strain) + 1 : 5, canX, canXX }
}

export function isDoubled(auction: AuctionEntry[]): { x: boolean; xx: boolean } {
  const lb = lastBid(auction)
  if (!lb) return { x: false, xx: false }
  let x = false
  let xx = false
  for (let i = auction.indexOf(lb) + 1; i < auction.length; i++) {
    const c = auction[i].call
    if (c.type === 'X' && seatPartnership(auction[i].seat) !== seatPartnership(lb.seat)) x = true
    if (c.type === 'XX') xx = true
  }
  return { x, xx }
}

/** 拍卖是否结束：有定约后连续三家 Pass，或四家全 Pass（流局） */
export function auctionOver(auction: AuctionEntry[]): boolean {
  if (auction.length < 4) return false
  const last3 = auction.slice(-3)
  const anyBid = auction.some((a) => a.call.type === 'bid')
  if (!anyBid) return auction.length >= 4 // 四家全派司
  return last3.every((a) => a.call.type === 'pass' || a.call.type === undefined)
}

export interface FinalContract {
  level: number
  strain: Strain
  doubled: Doubled
  declarer: Seat
}

export function getContract(auction: AuctionEntry[]): FinalContract | null {
  const lb = lastBid(auction)
  if (!lb || lb.call.type !== 'bid') return null
  const { level, strain } = lb.call
  // 庄家 = 该方最早叫出最终花色的人
  const side = seatPartnership(lb.seat)
  let declarer = lb.seat
  for (const a of auction) {
    if (a.call.type === 'bid' && a.call.strain === strain && seatPartnership(a.seat) === side) {
      declarer = a.seat
      break
    }
  }
  const d = isDoubled(auction)
  return { level, strain, doubled: d.xx ? 'XX' : d.x ? 'X' : 'none', declarer }
}

// ---------------------------------------------------------------------------
// AI 叫牌：按体系（自然 / 精确）的规则引擎。启发式，目标是"合理像样"。

interface Bid {
  type: 'bid'
  level: number
  strain: Strain
}

const bid = (level: number, strain: Strain): Call => ({ type: 'bid', level, strain })
const pass: Call = { type: 'pass' }
/** 估计同伴最近一次实质叫品的最低牌力 */
function partnerMin(auction: AuctionEntry[], seat: Seat, system: BiddingSystem): number {
  const partner = partnerOf(seat)
  const entries = auction.filter((a) => a.seat === partner)
  const meaningful = entries.filter((a) => a.call.type === 'bid')
  if (meaningful.length === 0) {
    // 只派司过
    return entries.length > 0 ? 0 : 0
  }
  const last = meaningful[meaningful.length - 1].call as Bid
  const prev = meaningful.length > 1 ? (meaningful[meaningful.length - 2].call as Bid) : null
  const isFirstBid = meaningful.length === 1 && entries[0].call.type === 'bid'

  // 开叫类
  if (isFirstBid) {
    if (system === 'precision') {
      if (last.strain === 'C' && last.level === 1) return 16
      if (last.strain === 'NT' && last.level === 1) return 13
      if (last.level === 1) return 11
      if (last.level === 2 && last.strain === 'C') return 11
    } else {
      if (last.strain === 'NT' && last.level === 1) return 15
      if (last.strain === 'C' && last.level === 2) return 22
      if (last.level === 1) return 12
      if (last.level === 2 && last.strain === 'NT') return 20
    }
    if (last.level === 2) return 6 // 弱二
  }
  // 应叫 / 再叫
  if (last.strain === 'NT') {
    if (last.level === 1) return 6
    if (last.level === 2) return 11
    return 13
  }
  if (prev && prev.strain === last.strain) {
    // 加叫同伴
    return last.level === 2 ? 6 : last.level === 3 ? 11 : 13
  }
  return last.level === 1 ? 6 : 11
}

/** 找到同伴展示过的最长花色（视为配合候选） */
function partnerSuit(auction: AuctionEntry[], seat: Seat): Strain | null {
  const partner = partnerOf(seat)
  const suits = auction
    .filter((a) => a.seat === partner && a.call.type === 'bid')
    .map((a) => (a.call as Bid).strain)
    .filter((s) => s !== 'NT')
  return suits.length ? suits[suits.length - 1] : null
}

function myLastSuit(auction: AuctionEntry[], seat: Seat): Strain | null {
  const suits = auction
    .filter((a) => a.seat === seat && a.call.type === 'bid')
    .map((a) => (a.call as Bid).strain)
    .filter((s) => s !== 'NT')
  return suits.length ? suits[suits.length - 1] : null
}

/** 主叫牌入口 */
export function chooseBid(hand: CardT[], auction: AuctionEntry[], seat: Seat, system: BiddingSystem): Call {
  const anyBid = auction.some((a) => a.call.type === 'bid')
  const partner = partnerOf(seat)
  const partnerBidEntries = auction.filter((a) => a.seat === partner && a.call.type === 'bid')
  const myBidEntries = auction.filter((a) => a.seat === seat && a.call.type === 'bid')
  const oppBids = auction.filter((a) => seatPartnership(a.seat) !== seatPartnership(seat) && a.call.type === 'bid')
  const rules = callRules(auction, seat)

  // 末家/防守叫：对手已开叫而同伴未叫 → 简单争叫
  if (anyBid && partnerBidEntries.length === 0 && myBidEntries.length === 0 && oppBids.length > 0) {
    return overcall(hand, auction, rules)
  }
  if (!anyBid) return opening(hand, system)
  if (partnerBidEntries.length > 0 && myBidEntries.length === 0) {
    return respond(hand, system, partnerBidEntries[partnerBidEntries.length - 1].call as Bid, rules)
  }
  if (myBidEntries.length > 0 && partnerBidEntries.length > 0) {
    return rebid(hand, auction, seat, system, rules)
  }
  return pass
}

function opening(hand: CardT[], system: BiddingSystem): Call {
  const ev = evalHand(hand)
  const { hcp: H, balanced, counts } = ev

  if (system === 'precision') {
    if (H >= 16) return bid(1, 'C')
    if (H >= 11) {
      if (balanced && H >= 13) return bid(1, 'NT')
      if (counts.S >= 5) return bid(1, 'S')
      if (counts.H >= 5) return bid(1, 'H')
      if (counts.C >= 6) return bid(2, 'C')
      return bid(1, 'D')
    }
  } else {
    if (H >= 22) return bid(2, 'C')
    if (balanced && H >= 20 && H <= 21) return bid(2, 'NT')
    if (balanced && H >= 15 && H <= 17) return bid(1, 'NT')
    if (H >= 12) {
      if (counts.S >= 5) return bid(1, 'S')
      if (counts.H >= 5) return bid(1, 'H')
      // 较长低花；3-3 开 1♣，4-4 开 1♦
      if (counts.D > counts.C) return bid(1, 'D')
      if (counts.C > counts.D) return bid(1, 'C')
      return counts.C >= 4 ? bid(1, 'D') : bid(1, 'C')
    }
  }
  // 弱二阻击
  const long = ev.longest
  if (H >= 6 && counts[long] >= 6 && long !== 'C') return bid(2, long)
  return pass
}

function overcall(hand: CardT[], auction: AuctionEntry[], rules: ReturnType<typeof callRules>): Call {
  const ev = evalHand(hand)
  const { hcp: H, counts } = ev
  const oppLast = lastBid(auction)
  const oppStrain = oppLast && oppLast.call.type === 'bid' ? oppLast.call.strain : null

  if (H >= 15 && H <= 18 && ev.balanced && oppStrain && oppStrain !== 'NT' && suitCount(hand, oppStrain as Suit) >= 3) {
    return tryBid(1, 'NT', rules)
  }
  if (H >= 12) {
    const s = ev.longest
    if (counts[s] >= 5) {
      const lvl = bidRank(1, s) >= rules.minBidRank ? 1 : 2
      const c = tryBid(lvl, s, rules)
      if (c.type === 'bid') return c
    }
  }
  // 技术性强牌可加倍
  if (H >= 16 && rules.canX) return { type: 'X' }
  return pass
}

function tryBid(level: number, strain: Strain, rules: ReturnType<typeof callRules>): Call {
  let lv = level
  while (lv <= 7 && bidRank(lv, strain) < rules.minBidRank) lv++
  if (lv > 7) return pass
  return bid(lv, strain)
}

function respond(
  hand: CardT[],
  system: BiddingSystem,
  opening: Bid,
  rules: ReturnType<typeof callRules>
): Call {
  const raw = respondRaw(hand, system, opening, rules)
  // 对手插叫后合法化：同花色抬到合法阶；被迫抬超过一阶则放弃
  if (raw.type !== 'bid') return raw
  const fixed = tryBid(raw.level, raw.strain, rules)
  if (fixed.type === 'bid' && fixed.level - raw.level > 1) return { type: 'pass' }
  return fixed
}

function respondRaw(
  hand: CardT[],
  system: BiddingSystem,
  opening: Bid,
  rules: ReturnType<typeof callRules>
): Call {
  const ev = evalHand(hand)
  const { hcp: H, counts } = ev

  // —— 精确制：对 1♣ 强开叫 ——
  if (system === 'precision' && opening.level === 1 && opening.strain === 'C') {
    if (H <= 7) return bid(1, 'D')
    const five = SUITS_BY_LEN(hand).find((s) => suitCount(hand, s) >= 5)
    if (ev.balanced || !five) return H >= 14 ? bid(2, 'NT') : bid(1, 'NT')
    const lvl = five === 'C' || five === 'D' ? 2 : 1
    return bid(lvl, suitToStrain(five))
  }

  // —— 对 1NT ——
  if (opening.level === 1 && opening.strain === 'NT') {
    const major5 = (['S', 'H'] as Suit[]).find((s) => counts[s] >= 5)
    if (H >= 10) return major5 ? bid(4, suitToStrain(major5)) : bid(3, 'NT')
    if (H >= 8) return bid(2, 'NT')
    if (major5 && counts[major5] >= 6) return tryBid(2, suitToStrain(major5), rules)
    return pass
  }

  // —— 对 2♣ 强开叫（自然制）——
  if (system === 'natural' && opening.level === 2 && opening.strain === 'C') {
    return bid(2, 'D')
  }

  // —— 对弱二 ——
  if (opening.level === 2) {
    if (H >= 16 && opening.strain !== 'NT' && suitCount(hand, strainToSuit(opening.strain)!) >= 3) {
      if (opening.strain === 'H' || opening.strain === 'S') return bid(4, opening.strain)
    }
    return pass
  }

  // —— 对一阶花色开叫 ——
  if (opening.level === 1 && opening.strain !== 'NT') {
    const oSuit = strainToSuit(opening.strain)!
    const isMajor = opening.strain === 'H' || opening.strain === 'S'
    const support = counts[oSuit]
    const fit = isMajor ? support >= 3 : support >= 4

    if (fit) {
      if (H >= 13) return bid(isMajor ? 4 : 5, opening.strain)
      if (H >= 11) return bid(3, opening.strain)
      if (H >= 6) return bid(2, opening.strain)
      return pass
    }
    if (H < 6) return pass
    // 找自己的套：先叫一阶四张高花
    if (counts.S >= 4 && opening.strain !== 'S' && bidRank(1, 'S') >= rules.minBidRank) return bid(1, 'S')
    if (counts.H >= 4 && opening.strain !== 'H' && bidRank(1, 'H') >= rules.minBidRank) return bid(1, 'H')
    if (H <= 10) return tryBid(1, 'NT', rules)
    if (H >= 11) {
      const mySuit = longestSuit(hand, oSuit)
      if (counts[mySuit] >= 4) return tryBid(2, suitToStrain(mySuit), rules)
      return tryBid(2, 'NT', rules)
    }
    return tryBid(1, 'NT', rules)
  }
  return pass
}

function rebid(hand: CardT[], auction: AuctionEntry[], seat: Seat, system: BiddingSystem, rules: ReturnType<typeof callRules>): Call {
  const ev = evalHand(hand)
  const H = ev.hcp
  const pMin = partnerMin(auction, seat, system)
  const combined = H + pMin
  const pSuit = partnerSuit(auction, seat)
  const mSuit = myLastSuit(auction, seat)

  // 同伴已叫到局/满贯 → 收兵（满贯边缘再试探从简）
  const lb = lastBid(auction)
  if (lb && lb.call.type === 'bid' && seatPartnership(lb.seat) === seatPartnership(seat)) {
    const cb = lb.call
    const isGame = (cb.strain === 'NT' && cb.level >= 3) || ((cb.strain === 'H' || cb.strain === 'S') && cb.level >= 4) || cb.level >= 5
    if (isGame) return pass
  }

  // 配合判断：同伴的套我有支持，或同伴加叫过我的套
  let fitStrain: Strain | null = null
  if (pSuit && pSuit !== 'NT') {
    const need = 3
    if (suitCount(hand, strainToSuit(pSuit)!) >= need) fitStrain = pSuit
  }
  if (!fitStrain && mSuit && pSuit === mSuit) fitStrain = mSuit

  if (combined >= 33) {
    if (fitStrain && fitStrain !== 'NT') return tryBid(6, fitStrain, rules)
    return tryBid(6, 'NT', rules)
  }
  if (combined >= 25) {
    if (fitStrain === 'H' || fitStrain === 'S') return tryBid(4, fitStrain, rules)
    if (fitStrain === 'C' || fitStrain === 'D') {
      if (H + pMin >= 29) return tryBid(5, fitStrain, rules)
      return tryBid(3, 'NT', rules)
    }
    return tryBid(3, 'NT', rules)
  }
  return pass
}

const SUITS_BY_LEN = (hand: CardT[]): Suit[] =>
  (['S', 'H', 'D', 'C'] as Suit[]).sort((a, b) => suitCount(hand, b) - suitCount(hand, a))

export function strainToSuit(strain: Strain): Suit | null {
  return strain === 'NT' ? null : (strain as Suit)
}

export function suitToStrain(suit: Suit): Strain {
  return suit as Strain
}

// ---------------------------------------------------------------------------
// 打牌逻辑

export interface TrickPlay {
  seat: Seat
  card: CardT
}

export function legalPlays(hand: CardT[], trick: TrickPlay[]): CardT[] {
  if (trick.length === 0) return hand
  const led = trick[0].card.suit
  const follow = hand.filter((c) => c.suit === led)
  return follow.length > 0 ? follow : hand
}

export function trickWinner(trick: TrickPlay[], trump: Suit | null): Seat {
  let best = trick[0]
  for (const p of trick.slice(1)) {
    const cur = best.card
    const c = p.card
    if (trump) {
      if (c.suit === trump && cur.suit !== trump) { best = p; continue }
      if (c.suit === trump && cur.suit === trump && c.rank > cur.rank) { best = p; continue }
      if (c.suit !== trump && cur.suit === trump) continue
    }
    if (c.suit === cur.suit && c.rank > cur.rank) best = p
  }
  return best.seat
}

// ---------------------------------------------------------------------------
// AI 出牌：规则启发式（首攻、跟牌、垫牌、将吃）

function lowest(cards: CardT[]): CardT {
  return [...cards].sort((a, b) => a.rank - b.rank)[0]
}

function highest(cards: CardT[]): CardT {
  return [...cards].sort((a, b) => b.rank - a.rank)[0]
}

function wouldWin(trick: TrickPlay[], seat: Seat, card: CardT, trump: Suit | null): boolean {
  return trickWinner([...trick, { seat, card }], trump) === seat
}

/** 首攻 */
function leadCard(hand: CardT[], trump: Suit | null): CardT {
  const suits = (['S', 'H', 'D', 'C'] as Suit[])
    .map((s) => ({ suit: s, cards: suitCards(hand, s) }))
    .filter((x) => x.cards.length > 0 && (trump === null || x.suit !== trump))
  const pool = suits.length > 0 ? suits : (['S', 'H', 'D', 'C'] as Suit[]).map((s) => ({ suit: s, cards: suitCards(hand, s) })).filter((x) => x.cards.length > 0)
  // 优先最长且有大牌的花色
  pool.sort((a, b) => b.cards.length - a.cards.length || hcpOf(b.cards) - hcpOf(a.cards))
  const chosen = pool[0].cards
  // 连张大牌攻顶张（AK、KQ、QJ）
  if (chosen.length >= 2 && chosen[0].rank >= 12 && chosen[0].rank === chosen[1].rank + 1) return chosen[0]
  if (chosen.length >= 4) return chosen[3] // 第四大牌
  return lowest(chosen)
}

function hcpOf(cards: CardT[]): number {
  return cards.reduce((s, c) => s + (c.rank >= 11 ? c.rank - 10 : 0), 0)
}

/** AI 选牌主入口 */
export function choosePlay(hand: CardT[], trick: TrickPlay[], trump: Suit | null, seat: Seat): CardT {
  const legal = legalPlays(hand, trick)
  if (legal.length === 1) return legal[0]
  if (trick.length === 0) return leadCard(hand, trump)

  const led = trick[0].card.suit
  const currentWinner = trickWinner(trick, trump)
  const partnerWinning = currentWinner === partnerOf(seat)
  const follow = legal.filter((c) => c.suit === led)

  if (follow.length > 0) {
    const winners = follow.filter((c) => wouldWin(trick, seat, c, trump))
    if (partnerWinning) return lowest(follow)
    if (winners.length > 0) {
      const win = lowest(winners)
      // 第三家：若能以大牌赢且后面还有一家，尽量赢但保留过大牌从简
      return win
    }
    return lowest(follow)
  }

  // 缺门：将吃或垫牌
  if (trump) {
    const trumps = legal.filter((c) => c.suit === trump)
    if (trumps.length > 0 && !partnerWinning) {
      const winners = trumps.filter((c) => wouldWin(trick, seat, c, trump))
      if (winners.length > 0) return lowest(winners)
    }
  }
  // 垫牌：从最短且最弱的花色垫最小牌（不垫将牌）
  const nonTrump = legal.filter((c) => c.suit !== trump)
  const pool = nonTrump.length > 0 ? nonTrump : legal
  const byWeakness = [...pool].sort((a, b) => {
    const la = suitCount(hand, a.suit)
    const lb = suitCount(hand, b.suit)
    return la - lb || a.rank - b.rank
  })
  return byWeakness[0]
}

// 供 UI：叫品是否人为约定（用于提醒标记）
export function isArtificial(call: Call, system: BiddingSystem, isOpening: boolean): boolean {
  if (call.type !== 'bid') return false
  if (system === 'precision' && call.level === 1 && call.strain === 'C') return true
  if (system === 'precision' && call.level === 1 && call.strain === 'D' && isOpening) return false // 1♦ 半自然
  if (system === 'natural' && call.level === 2 && call.strain === 'C') return true
  return false
}

export { highest, lowest }
