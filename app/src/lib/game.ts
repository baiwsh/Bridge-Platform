import type { Seat, Strain, Doubled, Vul } from './bridge'
import { seatPartnership } from './bridge'
import {
  type CardT,
  type Suit,
  cardId,
  evalHand,
  suitCards,
  suitCount,
  longestSuit,
} from './cards'
import type { BiddingSystem, ScoringMode } from './data'

/**
 * v1.9.0：AI 叫牌上下文（公开信息，不含任何暗牌）。
 * 局况与记分制会影响「值得一搏」的阈值：IMP 与有局时成局/满贯的收益更高。
 */
export interface BidContext {
  vul?: Vul
  scoring?: ScoringMode
  boardNo?: number
}

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

/** 主叫牌入口（v1.9.0：ctx 提供局况与记分制，用于进局/争叫的收益判断） */
export function chooseBid(hand: CardT[], auction: AuctionEntry[], seat: Seat, system: BiddingSystem, ctx: BidContext = {}): Call {
  const anyBid = auction.some((a) => a.call.type === 'bid')
  const partner = partnerOf(seat)
  const partnerBidEntries = auction.filter((a) => a.seat === partner && a.call.type === 'bid')
  const myBidEntries = auction.filter((a) => a.seat === seat && a.call.type === 'bid')
  const oppBids = auction.filter((a) => seatPartnership(a.seat) !== seatPartnership(seat) && a.call.type === 'bid')
  const rules = callRules(auction, seat)

  // 末家/防守叫：对手已开叫而同伴未叫 → 争叫
  if (anyBid && partnerBidEntries.length === 0 && myBidEntries.length === 0 && oppBids.length > 0) {
    return overcall(hand, auction, rules, ctx)
  }
  if (!anyBid) return opening(hand, system)
  if (partnerBidEntries.length > 0 && myBidEntries.length === 0) {
    return respond(hand, system, partnerBidEntries[partnerBidEntries.length - 1].call as Bid, rules)
  }
  if (myBidEntries.length > 0 && partnerBidEntries.length > 0) {
    return rebid(hand, auction, seat, system, rules, ctx)
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

function overcall(hand: CardT[], auction: AuctionEntry[], rules: ReturnType<typeof callRules>, ctx: BidContext): Call {
  const ev = evalHand(hand)
  const { hcp: H, counts } = ev
  const oppLast = lastBid(auction)
  const oppStrain = oppLast && oppLast.call.type === 'bid' ? oppLast.call.strain : null
  const oppSuit = oppStrain && oppStrain !== 'NT' ? strainToSuit(oppStrain) : null
  void ctx

  // 1NT 争叫：均型 15–18 点且敌方花色有止张（A/K/Q 或至少 3 张），否则庄家能一路兑现该套
  if (H >= 15 && H <= 18 && ev.balanced && oppStrain && oppStrain !== 'NT') {
    const oc = oppSuit ? suitCards(hand, oppSuit) : []
    const stopper = oc.some((c) => c.rank >= 12) || oc.length >= 3
    if (stopper) {
      const c = tryBid(1, 'NT', rules)
      if (c.type === 'bid' && c.level <= 2) return c
    }
  }
  // 花色争叫：套必须有一定质量（至少一张 10 以上大牌），且不被迫叫到过高的阶数
  if (H >= 12) {
    const s = ev.longest
    if (counts[s] >= 5) {
      const honors = suitCards(hand, s).filter((c) => c.rank >= 10).length
      if (honors >= 1 || H >= 15) {
        const lvl = bidRank(1, s) >= rules.minBidRank ? 1 : 2
        const c = tryBid(lvl, s, rules)
        if (c.type === 'bid' && (c.level <= 2 || H >= 16)) return c
      }
    }
  }
  // 技术性加倍：只针对一阶花色开叫，要求未叫花色有支持（典型技术性加倍牌型）或强牌
  if (rules.canX && oppLast && oppLast.call.type === 'bid' && oppLast.call.level === 1 && oppStrain !== 'NT') {
    const support = (['S', 'H', 'D', 'C'] as Suit[])
      .filter((s) => s !== oppSuit)
      .some((s) => suitCount(hand, s) >= (s === 'S' || s === 'H' ? 4 : 3))
    if ((H >= 13 && support) || H >= 17) return { type: 'X' }
  }
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

function rebid(hand: CardT[], auction: AuctionEntry[], seat: Seat, system: BiddingSystem, rules: ReturnType<typeof callRules>, ctx: BidContext): Call {
  const ev = evalHand(hand)
  const H = ev.hcp
  const pMin = partnerMin(auction, seat, system)
  const combined = H + pMin
  const pSuit = partnerSuit(auction, seat)
  const mSuit = myLastSuit(auction, seat)

  // v1.9.0：局况与记分制影响「值得一搏」的阈值——有局 / IMP 时成局与满贯的收益明显更高
  const vul = ctx.vul ?? 'none'
  const ourVul = vul === 'both' || vul === seatPartnership(seat)
  const aggressive = ctx.scoring === 'imp' || ourVul
  const slamAt = aggressive ? 32 : 33
  const gameAt = aggressive ? 24 : 25

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

  if (combined >= slamAt) {
    if (fitStrain && fitStrain !== 'NT') return tryBid(6, fitStrain, rules)
    return tryBid(6, 'NT', rules)
  }
  if (combined >= gameAt) {
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
// AI 出牌（v1.9.0 增强）：记牌 + 剩余大牌推断 + 位置化跟牌 + 首攻约定
//   · 旧版确定性规则保留为 choosePlayBasic，仅供 benchmark 作对照
//   · 增强版只使用「合法可见信息」：自己的手牌、明手牌（庄家方）、已出的牌、
//     当前墩、定约与庄家、局况；防守方拿不到任何暗牌
// ---------------------------------------------------------------------------

function lowest(cards: CardT[]): CardT {
  return [...cards].sort((a, b) => a.rank - b.rank)[0]
}

function highest(cards: CardT[]): CardT {
  return [...cards].sort((a, b) => b.rank - a.rank)[0]
}

function wouldWin(trick: TrickPlay[], seat: Seat, card: CardT, trump: Suit | null): boolean {
  return trickWinner([...trick, { seat, card }], trump) === seat
}

function hcpOf(cards: CardT[]): number {
  return cards.reduce((s, c) => s + (c.rank >= 11 ? c.rank - 10 : 0), 0)
}

/** AI 出牌可见上下文（v1.9.0）。防守方不会拿到 partnerHand。 */
export interface PlayContext {
  /** 本副已打出的牌（含当前墩），用于推断剩余大牌 */
  played?: CardT[]
  declarer?: Seat | null
  strain?: Strain | null
  vul?: Vul
  scoring?: ScoringMode
  tricksNS?: number
  tricksEW?: number
  boardNo?: number
  /** 仅庄家方可见的另一手牌（庄家看明手 / 明手看庄家） */
  partnerHand?: CardT[] | null
}

/**
 * 某花色中「外面还有几张比 rank 大的牌」。
 * 已见牌 = 自己手牌 + 当前墩 + 本副已出牌 + 庄家方可见的另一手。
 */
function outstandingHigher(suit: Suit, rank: number, hand: CardT[], trick: TrickPlay[], ctx: PlayContext): number {
  const seen = new Set<string>()
  for (const c of hand) seen.add(cardId(c))
  for (const p of trick) seen.add(cardId(p.card))
  for (const c of ctx.played ?? []) seen.add(cardId(c))
  for (const c of ctx.partnerHand ?? []) seen.add(cardId(c))
  let n = 0
  for (let r = rank + 1; r <= 14; r++) if (!seen.has(`${suit}${r}`)) n++
  return n
}

/** 确定赢张：同花色外面已没有更大的牌（不计将吃） */
function isBoss(card: CardT, hand: CardT[], trick: TrickPlay[], ctx: PlayContext): boolean {
  return outstandingHigher(card.suit, card.rank, hand, trick, ctx) === 0
}

/** 旧版规则，保留作基准对照（benchmark 用；生产只调 choosePlay） */
export function choosePlayBasic(hand: CardT[], trick: TrickPlay[], trump: Suit | null, seat: Seat): CardT {
  const legal = legalPlays(hand, trick)
  if (legal.length === 1) return legal[0]
  if (trick.length === 0) return basicLead(hand, trump)
  const led = trick[0].card.suit
  const partnerWinning = trickWinner(trick, trump) === partnerOf(seat)
  const follow = legal.filter((c) => c.suit === led)
  if (follow.length > 0) {
    const winners = follow.filter((c) => wouldWin(trick, seat, c, trump))
    if (partnerWinning) return lowest(follow)
    if (winners.length > 0) return lowest(winners)
    return lowest(follow)
  }
  if (trump) {
    const trumps = legal.filter((c) => c.suit === trump)
    if (trumps.length > 0 && !partnerWinning) {
      const winners = trumps.filter((c) => wouldWin(trick, seat, c, trump))
      if (winners.length > 0) return lowest(winners)
    }
  }
  const nonTrump = legal.filter((c) => c.suit !== trump)
  const pool = nonTrump.length > 0 ? nonTrump : legal
  const byWeakness = [...pool].sort((a, b) => {
    const la = suitCount(hand, a.suit)
    const lb = suitCount(hand, b.suit)
    return la - lb || a.rank - b.rank
  })
  return byWeakness[0]
}

/** 旧版首攻（仅 benchmark 对照用） */
function basicLead(hand: CardT[], trump: Suit | null): CardT {
  const suits = (['S', 'H', 'D', 'C'] as Suit[])
    .map((s) => ({ suit: s, cards: suitCards(hand, s) }))
    .filter((x) => x.cards.length > 0 && (trump === null || x.suit !== trump))
  const pool = suits.length > 0 ? suits : (['S', 'H', 'D', 'C'] as Suit[]).map((s) => ({ suit: s, cards: suitCards(hand, s) })).filter((x) => x.cards.length > 0)
  pool.sort((a, b) => b.cards.length - a.cards.length || hcpOf(b.cards) - hcpOf(a.cards))
  const chosen = pool[0].cards
  if (chosen.length >= 2 && chosen[0].rank >= 12 && chosen[0].rank === chosen[1].rank + 1) return chosen[0]
  if (chosen.length >= 4) return chosen[3]
  return lowest(chosen)
}

/** 增强版首攻 / 领出 */
function leadCard(hand: CardT[], trump: Suit | null, ctx: PlayContext, openingLead: boolean): CardT {
  // 非首攻领出：无将定约（或将牌本身）持有「确定赢张」时先兑现，避免残局被垫掉
  if (!openingLead) {
    const bosses = hand.filter((c) => (trump === null || c.suit === trump) && isBoss(c, hand, [], ctx))
    if (bosses.length > 0) return highest(bosses)
  }

  const suits = (['S', 'H', 'D', 'C'] as Suit[])
    .map((s) => ({ suit: s, cards: suitCards(hand, s) }))
    .filter((x) => x.cards.length > 0)
  if (suits.length === 0) return hand[0]

  // 有将定约不主动攻将牌（清将通常是庄家的活）；只剩将牌时再攻
  let pool = suits.filter((x) => !(trump && x.suit === trump))
  if (pool.length === 0) pool = suits

  const score = (x: { suit: Suit; cards: CardT[] }) => {
    const cards = x.cards
    const top = cards[0]
    const second = cards[1]
    let s = cards.length * 10
    s += hcpOf(cards) * 2
    // 连张大牌（AK / KQ / QJ / J10）攻顶张，既不送墩又能建立赢墩
    if (second && top.rank >= 11 && top.rank === second.rank + 1) s += 25
    // 孤 A（无 K）不首攻：保留进手，避免白送一墩
    if (top.rank === 14 && (!second || second.rank < 13)) s -= trump === null ? 12 : 30
    // 单张大牌容易被将吃或浪费
    if (cards.length === 1 && top.rank >= 11) s -= 12
    return s
  }
  pool.sort((a, b) => score(b) - score(a))
  const chosen = pool[0].cards

  if (chosen.length >= 2 && chosen[0].rank >= 11 && chosen[0].rank === chosen[1].rank + 1) return chosen[0]
  // 孤 A 改攻第二张，把 A 留作进手
  if (chosen.length >= 2 && chosen[0].rank === 14 && chosen[1].rank < 13) return chosen[1]
  if (chosen.length >= 4) return chosen[3] // 长四
  return lowest(chosen)
}

/** AI 选牌主入口（v1.9.0 增强） */
export function choosePlay(hand: CardT[], trick: TrickPlay[], trump: Suit | null, seat: Seat, ctx: PlayContext = {}): CardT {
  const legal = legalPlays(hand, trick)
  if (legal.length === 1) return legal[0]
  if (trick.length === 0) {
    const openingLead = (ctx.played?.length ?? 0) === 0
    return leadCard(hand, trump, ctx, openingLead)
  }

  const led = trick[0].card.suit
  const partnerWinning = trickWinner(trick, trump) === partnerOf(seat)
  const follow = legal.filter((c) => c.suit === led)

  if (follow.length > 0) {
    const low = lowest(follow)
    if (partnerWinning) return low // 同伴已赢：不盖同伴，放小保留大牌
    const winners = follow.filter((c) => wouldWin(trick, seat, c, trump))
    if (winners.length === 0) return low
    // 第二家放低：只有最小跟牌本身就能便宜赢墩时才出它（此时 low 就是最小赢张），
    // 否则绝不拿 K/A 去盖对手领出的牌（旧 AI 的主要漏墩点）。
    if (trick.length === 1) return low
    // 第三家 / 第四家：用能赢的最小张；是确定赢张也照赢，不白送这一墩
    return lowest(winners)
  }

  // 缺门：能赢则将吃，否则垫牌
  if (trump && !partnerWinning) {
    const trumps = legal.filter((c) => c.suit === trump)
    const ruffWinners = trumps.filter((c) => wouldWin(trick, seat, c, trump))
    if (ruffWinners.length > 0) {
      const ruff = lowest(ruffWinners)
      // 用大将牌将吃、且外面还有更大将牌可能被超将吃时不划算 → 改为垫牌保留将牌
      const expensive = ruff.rank >= 12 && outstandingHigher(trump, ruff.rank, hand, trick, ctx) > 0
      if (!expensive) return ruff
    }
  }

  // 垫牌：按「可丢弃程度」打分，优先垫短套小牌；保留确定赢张、大牌、长套与将牌
  const nonTrump = legal.filter((c) => c.suit !== trump)
  const pool = nonTrump.length > 0 ? nonTrump : legal
  const discardCost = (c: CardT) => {
    let s = 0
    if (c.suit === trump) s += 200
    if (isBoss(c, hand, trick, ctx)) s += 60
    s += Math.max(0, c.rank - 10) * 8
    s += suitCount(hand, c.suit) * 2
    return s
  }
  return [...pool].sort((a, b) => discardCost(a) - discardCost(b))[0]
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
