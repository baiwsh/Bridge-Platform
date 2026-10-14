import type { Seat, Vul } from './bridge'
import { boardDealer, boardVul } from './bridge'

// ---------------------------------------------------------------------------
// 确定性随机（用于每日赛：同一天所有牌手看到同样的牌局与对手成绩）

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// AI 牌手（大厅与每日赛的模拟对手）

export interface BotProfile {
  id: string
  name: string
  title: string
  rating: number
  color: string
}

export const BOTS: BotProfile[] = [
  { id: 'bot-lily', name: '莉娅', title: '精确制专家', rating: 1820, color: '#e11d48' },
  { id: 'bot-max', name: '老麦', title: '自然制老手', rating: 1650, color: '#0ea5e9' },
  { id: 'bot-qin', name: '秦桥', title: '双人赛常客', rating: 1710, color: '#f59e0b' },
  { id: 'bot-anna', name: '安娜', title: '防守大师', rating: 1780, color: '#8b5cf6' },
  { id: 'bot-tao', name: '涛声', title: '叫牌教科书', rating: 1600, color: '#10b981' },
  { id: 'bot-echo', name: '回声', title: 'AI 陪练', rating: 1500, color: '#64748b' },
  { id: 'bot-zhou', name: '周未', title: '周末牌手', rating: 1430, color: '#f97316' },
  { id: 'bot-ivy', name: '艾薇', title: '满贯猎手', rating: 1860, color: '#d946ef' },
  { id: 'bot-dan', name: '阿丹', title: '稳健派', rating: 1580, color: '#22d3ee' },
  { id: 'bot-rose', name: '玫瑰', title: '混合打法', rating: 1690, color: '#fb7185' },
  { id: 'bot-kai', name: '凯文', title: '新锐牌手', rating: 1390, color: '#a3e635' },
  { id: 'bot-mo', name: '墨白', title: '读牌高手', rating: 1750, color: '#facc15' },
]

// ---------------------------------------------------------------------------
// 大厅牌桌

export type BiddingSystem = 'precision' | 'natural'
export type ScoringMode = 'mp' | 'imp'
export type TableKind = 'quick' | 'friends' | 'bots' | 'event'
export type TableStatus = 'waiting' | 'playing' | 'full'

export interface BridgeTable {
  id: string
  name: string
  kind: TableKind
  system: BiddingSystem
  scoring: ScoringMode
  seats: (string | null)[] // N E S W，null = 空位
  status: TableStatus
  boards: number
  private?: boolean
  code?: string
  hostId?: string
}

export const KIND_LABEL: Record<TableKind, string> = {
  quick: '快速开始',
  friends: '好友约战',
  bots: '人机练习',
  event: '每日双人赛',
}

export const SYSTEM_LABEL: Record<BiddingSystem, string> = {
  precision: '精确制',
  natural: '自然制',
}

export const SCORING_LABEL: Record<ScoringMode, string> = {
  mp: '双人赛 · MP',
  imp: '队式赛 · IMP',
}

const botName = (id: string) => BOTS.find((b) => b.id === id)?.name ?? id

export function seatDisplay(seat: string | null): string {
  if (!seat) return ''
  return seat.startsWith('bot-') ? botName(seat) : seat
}

/** 初始大厅牌桌（模拟在线场景，类似 Trickster Cards 的大厅） */
export function initialTables(): BridgeTable[] {
  return [
    { id: 't-101', name: '晨曦牌室', kind: 'quick', system: 'natural', scoring: 'mp', seats: ['bot-lily', 'bot-max', null, null], status: 'waiting', boards: 8 },
    { id: 't-102', name: '精确之道', kind: 'quick', system: 'precision', scoring: 'mp', seats: ['bot-ivy', 'bot-qin', 'bot-tao', null], status: 'waiting', boards: 8 },
    { id: 't-103', name: '四人成行', kind: 'quick', system: 'natural', scoring: 'imp', seats: ['bot-anna', 'bot-zhou', 'bot-dan', 'bot-kai'], status: 'full', boards: 12 },
    { id: 't-104', name: '新手练习桌', kind: 'bots', system: 'natural', scoring: 'mp', seats: [null, 'bot-echo', null, 'bot-echo'], status: 'waiting', boards: 4 },
    { id: 't-105', name: '精确制练功房', kind: 'bots', system: 'precision', scoring: 'mp', seats: [null, 'bot-echo', null, 'bot-echo'], status: 'waiting', boards: 4 },
    { id: 't-106', name: '老友局 · 约战', kind: 'friends', system: 'natural', scoring: 'mp', seats: ['bot-mo', null, 'bot-rose', null], status: 'waiting', boards: 8, private: true, code: '2580' },
    { id: 't-107', name: '夜猫子牌局', kind: 'quick', system: 'precision', scoring: 'imp', seats: ['bot-ivy', 'bot-mo', null, null], status: 'waiting', boards: 12 },
    { id: 't-108', name: '午间快速场', kind: 'quick', system: 'natural', scoring: 'mp', seats: ['bot-dan', 'bot-lily', 'bot-rose', 'bot-tao'], status: 'playing', boards: 8 },
  ]
}

// ---------------------------------------------------------------------------
// 每日双人赛

export interface DailyBoard {
  board: number
  dealer: Seat
  vul: Vul
  /** 系统模拟出的"场上趋势"提示 */
  hint: string
}

export interface DailyEvent {
  id: string
  date: string
  title: string
  system: BiddingSystem
  boards: DailyBoard[]
  fieldSize: number
}

const HINTS = [
  '多桌打成 4♠，关键在将牌分布',
  '3NT 是主流定约，超墩决定名次',
  '部分定约争夺激烈，谨慎加倍',
  '有局方需警惕惩罚性加倍',
  '满贯边缘牌，场上分歧较大',
  '低阶定约，抢分与压制的博弈',
  '无将 vs 高花，体系选择见高下',
  '防守立功的一副，宕墩很常见',
]
export { HINTS }

export function todayEvent(date = new Date()): DailyEvent {
  const d = date.toISOString().slice(0, 10)
  const rng = mulberry32(hashString('daily-' + d))
  const boards: DailyBoard[] = Array.from({ length: 8 }, (_, i) => ({
    board: i + 1,
    dealer: boardDealer(i + 1),
    vul: boardVul(i + 1),
    hint: HINTS[Math.floor(rng() * HINTS.length)],
  }))
  return {
    id: `daily-${d}`,
    date: d,
    title: `${d} 每日双人赛`,
    system: rng() > 0.5 ? 'precision' : 'natural',
    boards,
    fieldSize: 8,
  }
}

export interface SimulatedScore {
  pairId: string
  name: string
  board: number
  contract: string
  nsScore: number
}

/** 为某副牌生成全场（除玩家外）的模拟成绩，围绕一个"基准定约"上下浮动 */
export function simulateBoardResults(eventId: string, board: number, userNsScore: number | null): SimulatedScore[] {
  const rng = mulberry32(hashString(`${eventId}-board-${board}`))
  const vul = boardVul(board)
  const bases = [
    { contract: '4♠ N', score: vul === 'NS' || vul === 'both' ? 620 : 420 },
    { contract: '3NT S', score: vul === 'NS' || vul === 'both' ? 600 : 400 },
    { contract: '4♥ S', score: vul === 'NS' || vul === 'both' ? 620 : 420 },
    { contract: '3NT N', score: vul === 'NS' || vul === 'both' ? 630 : 430 },
    { contract: '2♠ N', score: 110 },
    { contract: '1NT S', score: 90 },
    { contract: '3♦ W', score: -110 },
    { contract: '4♥ E', score: -(vul === 'EW' || vul === 'both' ? 620 : 420) },
  ]
  const base = bases[Math.floor(rng() * bases.length)]
  const pairs = BOTS.slice(0, 7)
  const out: SimulatedScore[] = pairs.map((b, i) => {
    const roll = rng()
    let score = base.score
    let contract = base.contract
    if (roll > 0.82) {
      // 少数对超/宕一墩
      const delta = Math.abs(base.score) >= 400 ? (base.score > 0 ? 30 : -30) : (base.score > 0 ? 20 : -20)
      score = base.score + delta
      contract = base.contract + (delta > 0 ? ' +1' : ' -1')
    } else if (roll < 0.12) {
      score = base.score > 0 ? base.score - 50 : base.score + 50
      contract = base.contract + ' ±'
    }
    return { pairId: `sim-${board}-${i}`, name: b.name, board, contract, nsScore: score }
  })
  if (userNsScore !== null) {
    out.push({ pairId: 'you', name: '你（南北）', board, contract: '你的成绩', nsScore: userNsScore })
  }
  return out
}

// ---------------------------------------------------------------------------
// 叫牌体系内容

export interface BidRow {
  bid: string
  meaning: string
  points?: string
  note?: string
}

export interface SystemSection {
  title: string
  rows: BidRow[]
}

export const NATURAL_SYSTEM: SystemSection[] = [
  {
    title: '开叫',
    rows: [
      { bid: '1♣ / 1♦', meaning: '低花开叫', points: '12–21', note: '3 张以上，无 5 张高花时开叫较长低花' },
      { bid: '1♥ / 1♠', meaning: '高花开叫', points: '12–21', note: '5 张以上（五张高花体系）' },
      { bid: '1NT', meaning: '均型牌', points: '15–17', note: '无 5 张高花，允许 5 张低花' },
      { bid: '2♣', meaning: '强牌逼叫', points: '22+', note: '人为叫品，逼叫一轮' },
      { bid: '2♦ / 2♥ / 2♠', meaning: '弱二开叫', points: '6–10', note: '6 张套，阻击性' },
      { bid: '2NT', meaning: '均型强牌', points: '20–21', note: '均型' },
      { bid: '3 阶花色', meaning: '阻击叫', points: '6–10', note: '7 张套' },
    ],
  },
  {
    title: '应叫（对 1 阶花色开叫）',
    rows: [
      { bid: '1 阶高花', meaning: '4 张以上', points: '6+', note: '一盖一不逼叫' },
      { bid: '1NT', meaning: '无配合', points: '6–10', note: '均型' },
      { bid: '加叫同伴花色', meaning: '3 张以上支持', points: '6–10', note: '简单加叫' },
      { bid: '跳加叫', meaning: '4 张支持', points: '11–12', note: '邀局' },
      { bid: '二盖一新花', meaning: '5 张以上', points: '11+', note: '逼叫一轮' },
      { bid: '2NT', meaning: '均型邀局', points: '11–12', note: 'Jacoby 2NT 体系另约定' },
    ],
  },
  {
    title: '常用约定',
    rows: [
      { bid: '斯台曼 2♣', meaning: '问 4 张高花', points: '8+', note: '对 1NT 开叫' },
      { bid: '转移叫', meaning: '2♦→♥ / 2♥→♠', points: '0+', note: '对 1NT 开叫' },
      { bid: '黑木 4NT', meaning: '问 A', points: '满贯试探', note: '答叫：03/14/2/2+Q' },
      { bid: '负加倍', meaning: '显示另一高花', points: '8+', note: '对手争叫后' },
    ],
  },
]

export const PRECISION_SYSTEM: SystemSection[] = [
  {
    title: '开叫',
    rows: [
      { bid: '1♣', meaning: '任意强牌', points: '16+', note: '人为叫品，逼叫（核心叫品）' },
      { bid: '1♦', meaning: '非强牌均型/低花', points: '11–15', note: '2 张以上，不保证实套' },
      { bid: '1♥ / 1♠', meaning: '5 张以上', points: '11–15', note: '限定性强度的五张高花' },
      { bid: '1NT', meaning: '均型', points: '13–15', note: '比自然制弱无将更轻' },
      { bid: '2♣', meaning: '6 张以上梅花', points: '11–15', note: '或 5♣+4 张高花' },
      { bid: '2♦', meaning: '三套牌', points: '11–15', note: '4-4-1-4 或 4-3-1-5 等短方块牌型' },
      { bid: '2♥ / 2♠', meaning: '弱二', points: '6–10', note: '6 张套' },
      { bid: '2NT', meaning: '均型强牌', points: '16–18/19+', note: '按约定分级' },
    ],
  },
  {
    title: '对 1♣ 强开叫的应叫',
    rows: [
      { bid: '1♦', meaning: '示弱', points: '0–7', note: '人为叫品' },
      { bid: '1♥ / 1♠ / 2♣ / 2♦', meaning: '实套积极应叫', points: '8+', note: '5 张以上，逼叫成局' },
      { bid: '1NT', meaning: '均型', points: '8–13', note: '无 5 张套' },
      { bid: '跳叫花色', meaning: '坚强套', points: '8+', note: '邀请满贯' },
    ],
  },
  {
    title: '对 1♦ / 1 高花开叫的应叫',
    rows: [
      { bid: '1 阶高花', meaning: '4 张以上', points: '8+', note: '逼叫一轮' },
      { bid: '1NT', meaning: '均型', points: '8–10', note: '不逼叫' },
      { bid: '2♣（对 1♦）', meaning: '问叫', points: '11+', note: '要求开叫方进一步描述' },
      { bid: '加叫', meaning: '支持', points: '8–10', note: '3 张以上' },
      { bid: '2NT', meaning: '均型邀局', points: '11–12', note: '—' },
    ],
  },
  {
    title: '常用约定',
    rows: [
      { bid: '控制问叫', meaning: '问 A/K 控制数', points: '强叫后', note: 'A=2 控制，K=1 控制' },
      { bid: '阿尔法问叫', meaning: '问套内大牌', points: '强叫后', note: '1♣ 开叫体系的核心武器' },
      { bid: '斯台曼', meaning: '问高花', points: '8+', note: '对 1NT 开叫' },
      { bid: '黑木 4NT', meaning: '问 A', points: '满贯试探', note: '与自然制一致' },
    ],
  },
]
