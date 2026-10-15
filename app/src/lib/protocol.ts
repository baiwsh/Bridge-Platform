// 联机协议：前后端共享的消息与视图类型
import type { Seat, Strain, Doubled, Vul } from './bridge'
import type { CardT, Suit } from './cards'
import type { AuctionEntry, Call, FinalContract, TrickPlay } from './game'
import type { BiddingSystem, ScoringMode, TableKind } from './data'

export type { Seat, CardT, Call, AuctionEntry, TrickPlay, FinalContract }

export interface SeatPlayerInfo {
  name: string
  bot: boolean
  color?: string
  online?: boolean
  /** 真人断线托管中（bot 为 true 但座位属于真人，不可被接管） */
  managed?: boolean
}

export interface TableSummary {
  id: string
  name: string
  kind: TableKind
  system: BiddingSystem
  scoring: ScoringMode
  boards: number
  seats: (string | null)[]
  status: 'waiting' | 'playing' | 'full'
}

export interface ScoreRowMsg {
  board: number
  contract: string
  nsScore: number
  tricksNS: number
  tricksEW: number
}

/** 服务端推送给某个玩家的个性化牌局视图（只含自己能看到的牌） */
export interface ViewState {
  tableId: string
  tableName: string
  system: BiddingSystem
  scoring: ScoringMode
  boards: number
  boardNo: number
  phase: 'lobby' | 'bidding' | 'play' | 'scored'
  dealer: Seat
  vul: Vul
  turn: Seat | null
  players: Record<Seat, SeatPlayerInfo>
  mySeat: Seat | null
  myHand: CardT[]
  dummySeat: Seat | null
  dummyHand: CardT[] | null
  allHands: Record<Seat, CardT[]> | null
  counts: Record<Seat, number>
  auction: AuctionEntry[]
  contract: FinalContract | null
  trump: Suit | null
  trick: TrickPlay[]
  tricksNS: number
  tricksEW: number
  scores: ScoreRowMsg[]
  result: ScoreRowMsg | null
  /** 轮到我行动（叫牌或出牌，含庄家代明手） */
  myTurn: boolean
  legalPlayIds: string[]
  canStart: boolean
  gameOver: boolean
  passedOut: boolean
  msg?: string
}

// ---- 每日双人赛 ----

export interface DailyBoardStatus {
  board: number
  dealer: Seat
  vul: Vul
  hint: string
  played: boolean
  contract?: string
  nsScore?: number
  mp?: number
  maxMp?: number
}

export interface DailyLeaderboardRow {
  pairId: string
  name: string
  mp: number
  maxMp: number
  pct: number
  rank: number
  you?: boolean
}

export interface DailyLiveRow {
  name: string
  done: number
  you?: boolean
}

export interface DailyState {
  eventId: string
  date: string
  title: string
  system: BiddingSystem
  fieldSize: number
  boards: DailyBoardStatus[]
  myDone: number
  /** 完赛后的全场百分比；未完赛为 null */
  myPct: number | null
  leaderboard: DailyLeaderboardRow[]
  live: DailyLiveRow[]
}

// ---- 客户端 → 服务端 ----
export type ClientMsg =
  | { t: 'watch'; tableId: string }
  | { t: 'unwatch' }
  | { t: 'create'; name: string; system: BiddingSystem; scoring: ScoringMode; boards: number; kind: TableKind }
  | { t: 'join'; tableId: string }
  | { t: 'takeover'; tableId: string; seat: Seat }
  | { t: 'leave' }
  | { t: 'start' }
  | { t: 'bid'; call: Call }
  | { t: 'play'; card: CardT }
  | { t: 'next' }
  | { t: 'restart' }
  | { t: 'daily' }
  | { t: 'dailyPlay'; board: number }

// ---- 服务端 → 客户端 ----
export type ServerMsg =
  | { t: 'tables'; tables: TableSummary[] }
  | { t: 'view'; view: ViewState | null }
  | { t: 'daily'; daily: DailyState }
  | { t: 'error'; message: string }

export interface PublicUser {
  id: string
  username: string
  nickname: string
  color: string
  createdAt: string
  rating: number
  gamesPlayed: number
  bestPct: number
}

export type { Strain, Doubled }
