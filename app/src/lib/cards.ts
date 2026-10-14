import type { Seat } from './bridge'

// ---------------------------------------------------------------------------
// 纸牌与发牌

export type Suit = 'C' | 'D' | 'H' | 'S'

export interface CardT {
  suit: Suit
  /** 2..14，11=J 12=Q 13=K 14=A */
  rank: number
}

export const SUITS: Suit[] = ['C', 'D', 'H', 'S']
export const SUIT_LABEL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' }
export const SUIT_CN: Record<Suit, string> = { C: '梅花', D: '方块', H: '红桃', S: '黑桃' }

export function rankLabel(rank: number): string {
  if (rank === 14) return 'A'
  if (rank === 13) return 'K'
  if (rank === 12) return 'Q'
  if (rank === 11) return 'J'
  return String(rank)
}

export function cardLabel(c: CardT): string {
  return SUIT_LABEL[c.suit] + rankLabel(c.rank)
}

export function cardId(c: CardT): string {
  return `${c.suit}${c.rank}`
}

export function newDeck(): CardT[] {
  const deck: CardT[] = []
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push({ suit, rank })
  return deck
}

export function shuffled<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 发牌：N/E/S/W 各 13 张，按桥牌习惯排序（花色 S>H>D>C，同花色大牌在前） */
export function dealHands(rnd: () => number = Math.random): Record<Seat, CardT[]> {
  const deck = shuffled(newDeck(), rnd)
  const seats: Seat[] = ['N', 'E', 'S', 'W']
  const hands = {} as Record<Seat, CardT[]>
  seats.forEach((s, i) => {
    hands[s] = sortHand(deck.slice(i * 13, i * 13 + 13))
  })
  return hands
}

const SUIT_ORDER: Suit[] = ['S', 'H', 'D', 'C']

export function sortHand(hand: CardT[]): CardT[] {
  return [...hand].sort((a, b) => {
    const s = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit)
    return s !== 0 ? s : b.rank - a.rank
  })
}

// ---------------------------------------------------------------------------
// 牌力评估

export function hcp(hand: CardT[]): number {
  return hand.reduce((sum, c) => sum + (c.rank >= 11 ? c.rank - 10 : 0), 0)
}

export function suitCount(hand: CardT[], suit: Suit): number {
  return hand.filter((c) => c.suit === suit).length
}

export function suitCards(hand: CardT[], suit: Suit): CardT[] {
  return hand.filter((c) => c.suit === suit).sort((a, b) => b.rank - a.rank)
}

export function isBalanced(hand: CardT[]): boolean {
  const counts = SUITS.map((s) => suitCount(hand, s)).sort((a, b) => a - b)
  // 4-3-3-3 / 4-4-3-2 / 5-3-3-2
  return (
    (counts[0] === 3 && counts[3] === 4) ||
    (counts[0] === 2 && counts[1] === 3 && counts[2] === 4 && counts[3] === 4) ||
    (counts[0] === 2 && counts[1] === 3 && counts[2] === 3 && counts[3] === 5)
  )
}

/** 最长花色（并列时取牌点高的） */
export function longestSuit(hand: CardT[], exclude?: Suit): Suit {
  let best: Suit = 'C'
  let bestLen = -1
  let bestHcp = -1
  for (const s of SUITS) {
    if (s === exclude) continue
    const cards = suitCards(hand, s)
    const h = cards.reduce((sum, c) => sum + (c.rank >= 11 ? c.rank - 10 : 0), 0)
    if (cards.length > bestLen || (cards.length === bestLen && h > bestHcp)) {
      best = s
      bestLen = cards.length
      bestHcp = h
    }
  }
  return best
}

export interface HandEval {
  hcp: number
  balanced: boolean
  counts: Record<Suit, number>
  longest: Suit
}

export function evalHand(hand: CardT[]): HandEval {
  const counts = { C: suitCount(hand, 'C'), D: suitCount(hand, 'D'), H: suitCount(hand, 'H'), S: suitCount(hand, 'S') } as Record<Suit, number>
  return { hcp: hcp(hand), balanced: isBalanced(hand), counts, longest: longestSuit(hand) }
}
