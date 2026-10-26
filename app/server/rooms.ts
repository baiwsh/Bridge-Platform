// 服务端牌桌房间：权威对局状态 + AI 补位 + 断线托管
// 引擎逻辑复用前端同一份 src/lib（规则唯一来源，避免前后端规则漂移）
import {
  boardDealer,
  boardVul,
  contractScore,
  describeContract,
  nsImp,
  seatPartnership,
  type Seat,
  type Vul,
} from '../src/lib/bridge'
import { cardId, dealHands, type CardT, type Suit } from '../src/lib/cards'
import {
  auctionOver,
  callRules,
  chooseBid,
  choosePlay,
  getContract,
  legalPlays,
  nextSeat,
  partnerOf,
  trickWinner,
  type AuctionEntry,
  type Call,
  type FinalContract,
  type TrickPlay,
} from '../src/lib/game'
import { BOTS, initialTables, type BiddingSystem, type ScoringMode, type TableKind } from '../src/lib/data'
import type { PublicUser, ScoreRowMsg, SeatPlayerInfo, TableSummary, ViewState } from '../src/lib/protocol'
import { bumpGamesPlayed } from './db'

const SEATS: Seat[] = ['N', 'E', 'S', 'W']

// AI 行动节奏（可用环境变量加速，便于自动化测试）
const BOT_BID_MS = parseInt(process.env.BOT_BID_MS ?? '650')
const BOT_PLAY_MS = parseInt(process.env.BOT_PLAY_MS ?? '750')
/** 一墩收齐后停留多久再清台：默认 1 秒，留出看清四家出牌的时间（可用环境变量覆盖） */
const TRICK_CLEAR_MS = parseInt(process.env.TRICK_CLEAR_MS ?? '1000')

interface SeatHolder {
  kind: 'human' | 'bot'
  userId?: string
  name: string
  color?: string
  online: boolean
  /** 断线 AI 托管中：保留 userId 与座位归属，重连后恢复手动 */
  managed?: boolean
}

interface RoomGameState {
  hands: Record<Seat, CardT[]>
  origHands: Record<Seat, CardT[]> // 本副发牌快照，供打完回顾
  auction: AuctionEntry[]
  phase: 'bidding' | 'play' | 'scored'
  turn: Seat
  dealer: Seat
  vul: Vul
  contract: FinalContract | null
  trump: Suit | null
  trick: TrickPlay[]
  tricksNS: number
  tricksEW: number
  passedOut: boolean
  result: ScoreRowMsg | null
}

export class Room {
  id: string
  name: string
  kind: TableKind
  system: BiddingSystem
  scoring: ScoringMode
  boards: number
  seats: Record<Seat, SeatHolder | null> = { N: null, E: null, S: null, W: null }

  /** 隐藏房（每日赛）：不出现在大厅列表，离开/断线不转托管 */
  hidden: boolean
  /** 固定副号（每日赛）：dealer/vul 与视图都按真实副号 */
  fixedBoardNo?: number
  /** 固定发牌（每日赛）：全场同牌 */
  seedDeal?: () => Record<Seat, CardT[]>
  /** 每副记分完成回调（每日赛：成绩入库） */
  onBoardScored?: (row: ScoreRowMsg) => void

  started = false
  boardNo = 1
  scores: ScoreRowMsg[] = []
  gs: RoomGameState | null = null

  private timer: NodeJS.Timeout | null = null
  /** 明手真人代打 AI 庄家：本副内庄家（与明手）的出牌由该 userId 操作 */
  private proxyBy: string | null = null
  private onChange: () => void

  constructor(opts: {
    id: string
    name: string
    kind: TableKind
    system: BiddingSystem
    scoring: ScoringMode
    boards: number
    onChange: () => void
    hidden?: boolean
    fixedBoardNo?: number
    seedDeal?: () => Record<Seat, CardT[]>
    onBoardScored?: (row: ScoreRowMsg) => void
  }) {
    this.id = opts.id
    this.name = opts.name
    this.kind = opts.kind
    this.system = opts.system
    this.scoring = opts.scoring
    this.boards = opts.boards
    this.onChange = opts.onChange
    this.hidden = !!opts.hidden
    this.fixedBoardNo = opts.fixedBoardNo
    this.seedDeal = opts.seedDeal
    this.onBoardScored = opts.onBoardScored
    if (opts.fixedBoardNo) this.boardNo = opts.fixedBoardNo
  }

  // ---------- 座位管理 ----------

  seatOf(userId: string): Seat | null {
    for (const s of SEATS) {
      const h = this.seats[s]
      if (h?.kind === 'human' && h.userId === userId) return s
    }
    return null
  }

  join(user: PublicUser): Seat | null {
    const existing = this.seatOf(user.id)
    if (existing) {
      this.seats[existing]!.online = true
      this.seats[existing]!.managed = false // 回到座位：解除托管
      return existing
    }
    const empty = SEATS.find((s) => this.seats[s] === null)
    if (!empty) return null
    this.seats[empty] = { kind: 'human', userId: user.id, name: user.nickname, color: user.color, online: true }
    return empty
  }

  /** 旁观者接管 AI 座位：仅限纯 AI（真人托管中的座位不可接管） */
  takeover(user: PublicUser, seat: Seat): string | null {
    const h = this.seats[seat]
    if (!h || h.kind !== 'bot') return '该座位不是 AI 牌手'
    if (this.seatOf(user.id) !== null) return '你已在本桌座位上'
    this.seats[seat] = { kind: 'human', userId: user.id, name: user.nickname, color: user.color, online: true }
    // 清除该座位待执行的 AI 定时器（schedule 开头会 clearTimeout 并重新评估）
    this.schedule()
    return null
  }

  /** 明手真人代打 AI 庄家：仅限打牌阶段、自己是明手、庄家是纯 AI */
  setProxy(userId: string, on: boolean): string | null {
    const gs = this.gs
    if (!gs || gs.phase !== 'play' || !gs.contract) return '当前不能代打'
    const mySeat = this.seatOf(userId)
    if (mySeat === null) return '你不在座位上'
    const dummy = partnerOf(gs.contract.declarer)
    if (mySeat !== dummy) return '只有明手可以代打庄家'
    const h = this.seats[gs.contract.declarer]
    if (!h || h.kind !== 'bot' || h.managed) return '庄家不是 AI，不能代打'
    this.proxyBy = on ? userId : null
    this.schedule()
    return null
  }

  /** 指定座位入座（每日赛真人固定坐南，保证其成绩记为南北分） */
  joinAt(user: PublicUser, seat: Seat): Seat | null {
    const existing = this.seatOf(user.id)
    if (existing) {
      this.seats[existing]!.online = true
      this.seats[existing]!.managed = false
      return existing
    }
    const h = this.seats[seat]
    if (h && h.kind === 'human') return null
    this.seats[seat] = { kind: 'human', userId: user.id, name: user.nickname, color: user.color, online: true }
    return seat
  }

  leave(userId: string) {
    const seat = this.seatOf(userId)
    if (!seat) return
    if (this.started) {
      this.toBot(seat) // 对局中主动离开 → 放弃座位，AI 托管到底
    } else {
      this.seats[seat] = null
    }
  }

  disconnect(userId: string) {
    const seat = this.seatOf(userId)
    if (this.proxyBy === userId) this.proxyBy = null // 代打者断线：交还 AI
    if (!seat) return
    this.seats[seat]!.online = false
    // 断线（关页面/掉线）：普通房保留席位并 AI 托管，重连后恢复手动；
    // 隐藏房（每日赛）不托管：要么回来继续，要么整桌回收重开
    if (this.started && !this.hidden) this.seats[seat]!.managed = true
  }

  reconnect(userId: string) {
    const seat = this.seatOf(userId)
    if (seat) {
      this.seats[seat]!.online = true
      this.seats[seat]!.managed = false
    }
  }

  /** 真人产生任何主动操作 → 视为回到牌桌，解除托管 */
  private resume(userId: string) {
    const seat = this.seatOf(userId)
    if (seat && this.seats[seat]) this.seats[seat]!.managed = false
  }

  /** 该座位当前由 AI 驱动（纯 AI 或托管中的真人） */
  private botDriven(seat: Seat): boolean {
    const h = this.seats[seat]
    return !!h && (h.kind === 'bot' || !!h.managed)
  }

  private toBot(seat: Seat) {
    const h = this.seats[seat]
    if (!h || h.kind !== 'human') return
    this.seats[seat] = { kind: 'bot', name: h.name + '·托管', color: h.color, online: true }
    this.schedule()
  }

  get humanCount(): number {
    return SEATS.filter((s) => this.seats[s]?.kind === 'human').length
  }

  private get onlineHumanCount(): number {
    return SEATS.filter((s) => this.seats[s]?.kind === 'human' && this.seats[s]!.online).length
  }

  /** 可回收：普通房=无真人且未开始；隐藏房=无在线真人且（未开始或已记分） */
  get disposable(): boolean {
    if (this.hidden) {
      return this.onlineHumanCount === 0 && (!this.started || this.gs?.phase === 'scored')
    }
    return this.humanCount === 0 && !this.started
  }

  summary(): TableSummary {
    const filled = SEATS.filter((s) => this.seats[s] !== null).length
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      system: this.system,
      scoring: this.scoring,
      boards: this.boards,
      seats: SEATS.map((s) => this.seats[s]?.name ?? null),
      status: this.started ? 'playing' : filled >= 4 ? 'full' : 'waiting',
    }
  }

  // ---------- 对局流程 ----------

  start(byUserId: string): string | null {
    if (this.started) return '牌局已开始'
    if (this.seatOf(byUserId) === null) return '请先入座'
    // 空位补 AI
    const usedNames = new Set(SEATS.map((s) => this.seats[s]?.name).filter(Boolean))
    const freeBots = BOTS.filter((b) => !usedNames.has(b.name))
    let bi = 0
    for (const s of SEATS) {
      if (!this.seats[s]) {
        const b = freeBots[bi++ % freeBots.length]
        this.seats[s] = { kind: 'bot', name: b.name, color: b.color, online: true }
      }
    }
    this.started = true
    this.boardNo = this.fixedBoardNo ?? 1
    this.scores = []
    this.newBoard(this.boardNo)
    this.onChange()
    this.schedule()
    return null
  }

  private newBoard(boardNo: number) {
    const dealer = boardDealer(boardNo)
    this.proxyBy = null // 每副重置代打状态
    const hands = this.seedDeal ? this.seedDeal() : dealHands()
    this.gs = {
      hands,
      origHands: { N: [...hands.N], E: [...hands.E], S: [...hands.S], W: [...hands.W] },
      auction: [],
      phase: 'bidding',
      turn: dealer,
      dealer,
      vul: boardVul(boardNo),
      contract: null,
      trump: null,
      trick: [],
      tricksNS: 0,
      tricksEW: 0,
      passedOut: false,
      result: null,
    }
  }

  bid(userId: string, call: Call): string | null {
    const gs = this.gs
    if (!gs || gs.phase !== 'bidding') return '当前不能叫牌'
    const seat = this.seatOf(userId)
    if (seat === null || seat !== gs.turn) return '还没轮到你'
    this.resume(userId)
    // 合法性
    if (call.type === 'bid') {
      const rules = callRules(gs.auction, seat)
      const rank = call.level * 5 + ['C', 'D', 'H', 'S', 'NT'].indexOf(call.strain)
      if (rank < rules.minBidRank) return '叫品低于当前定约'
    }
    if (call.type === 'X' && !callRules(gs.auction, seat).canX) return '当前不能加倍'
    if (call.type === 'XX' && !callRules(gs.auction, seat).canXX) return '当前不能再加倍'
    this.applyBid(call)
    this.onChange()
    this.schedule()
    return null
  }

  private applyBid(call: Call) {
    const gs = this.gs!
    gs.auction = [...gs.auction, { seat: gs.turn, call }]
    if (auctionOver(gs.auction)) {
      const contract = getContract(gs.auction)
      if (!contract) {
        const boardNo = this.boardNo
        this.newBoard(boardNo)
        this.gs!.passedOut = true
        return
      }
      gs.contract = contract
      gs.trump = contract.strain === 'NT' ? null : (contract.strain as Suit)
      gs.phase = 'play'
      gs.turn = nextSeat(contract.declarer)
      gs.trick = []
      return
    }
    gs.turn = nextSeat(gs.turn)
  }

  play(userId: string, card: CardT): string | null {
    const gs = this.gs
    if (!gs || gs.phase !== 'play') return '当前不能出牌'
    if (gs.trick.length === 4) return '正在收墩，请稍候'
    const turn = gs.turn
    const mySeat = this.seatOf(userId)
    if (mySeat === null) return '你不在座位上'
    this.resume(userId)
    const dummy = partnerOf(gs.contract!.declarer)
    // 只能打自己的牌；庄家可代明手；明手真人可代打 AI 庄家（含明手自己）
    const controls =
      mySeat === turn ||
      (turn === dummy && mySeat === gs.contract!.declarer) ||
      (this.proxyBy === userId && (turn === gs.contract!.declarer || turn === dummy))
    if (!controls) return '还没轮到你'
    const legal = legalPlays(gs.hands[turn], gs.trick)
    if (!legal.some((c) => cardId(c) === cardId(card))) return '必须跟出同花色牌'
    this.applyPlay(turn, card)
    this.onChange()
    this.schedule()
    return null
  }

  /**
   * 明手是否已摊牌：按桥牌规则，首攻（本副第一张牌）打出后明手才摊开。
   * 服务端据此裁剪视图——首攻前不下发明手牌，避免客户端提前看到。
   */
  private dummyRevealed(): boolean {
    const gs = this.gs
    if (!gs) return false
    if (gs.phase === 'scored') return true
    return gs.trick.length > 0 || gs.tricksNS + gs.tricksEW > 0
  }

  private applyPlay(seat: Seat, card: CardT) {
    const gs = this.gs!
    gs.hands = { ...gs.hands, [seat]: gs.hands[seat].filter((c) => cardId(c) !== cardId(card)) }
    gs.trick = [...gs.trick, { seat, card }]
    if (gs.trick.length < 4) {
      gs.turn = nextSeat(seat)
      return
    }
    const winner = trickWinner(gs.trick, gs.trump)
    const winNS = seatPartnership(winner) === 'NS'
    gs.tricksNS += winNS ? 1 : 0
    gs.tricksEW += winNS ? 0 : 1
    const done = gs.hands.N.length === 0 && gs.contract !== null
    if (done && gs.contract) {
      const c = gs.contract
      const decTricks = seatPartnership(c.declarer) === 'NS' ? gs.tricksNS : gs.tricksEW
      const scored = contractScore({ level: c.level, strain: c.strain, doubled: c.doubled, declarer: c.declarer, tricks: decTricks, vul: gs.vul })
      const nsScore = seatPartnership(c.declarer) === 'NS' ? scored.score : -scored.score
      gs.result = {
        board: this.boardNo,
        contract: describeContract({ level: c.level, strain: c.strain, doubled: c.doubled, declarer: c.declarer, tricks: decTricks, vul: gs.vul }),
        nsScore,
        tricksNS: gs.tricksNS,
        tricksEW: gs.tricksEW,
        // 队式赛模式：按副换算 IMP，累计后即为该桌的最终胜负依据
        imp: this.scoring === 'imp' ? nsImp(nsScore) : undefined,
      }
      gs.phase = 'scored'
      this.scores.push(gs.result)
      this.onBoardScored?.(gs.result)
      if (this.boardNo >= this.boards && !this.hidden) {
        // 整场结束：给真人记参赛数（每日赛由赛事模块统一结算，不在此累计）
        for (const s of SEATS) {
          const h = this.seats[s]
          if (h?.kind === 'human' && h.userId) bumpGamesPlayed(h.userId)
        }
      }
      return
    }
    gs.turn = winner
  }

  next(userId: string): string | null {
    if (!this.gs || this.gs.phase !== 'scored') return '当前不能进入下一副'
    if (this.seatOf(userId) === null) return '你不在座位上'
    this.resume(userId)
    if (this.boardNo >= this.boards) return '本场已结束'
    this.boardNo += 1
    this.newBoard(this.boardNo)
    this.onChange()
    this.schedule()
    return null
  }

  restart(userId: string): string | null {
    if (this.seatOf(userId) === null) return '你不在座位上'
    this.resume(userId)
    if (this.kind === 'event') return '比赛牌局不可重开'
    this.started = true
    this.boardNo = this.fixedBoardNo ?? 1
    this.scores = []
    this.newBoard(this.boardNo)
    this.onChange()
    this.schedule()
    return null
  }

  // ---------- AI 驱动 ----------

  private schedule() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const gs = this.gs
    if (!this.started || !gs) return

    if (gs.phase === 'bidding') {
      if (!this.botDriven(gs.turn)) return
      this.timer = setTimeout(() => {
        const call = chooseBid(gs.hands[gs.turn], gs.auction, gs.turn, this.system)
        this.applyBid(call)
        this.onChange()
        this.schedule()
      }, BOT_BID_MS)
      return
    }

    if (gs.phase === 'play') {
      if (gs.trick.length === 4) {
        this.timer = setTimeout(() => {
          gs.trick = []
          this.onChange()
          this.schedule()
        }, TRICK_CLEAR_MS)
        return
      }
      const turn = gs.turn
      const dummy = partnerOf(gs.contract!.declarer)
      const decider = turn === dummy ? gs.contract!.declarer : turn
      // 明手真人代打中：庄家与明手的出牌都交给真人，AI 不动作
      if (this.proxyBy && (turn === gs.contract!.declarer || turn === dummy)) return
      if (!this.botDriven(decider)) return
      this.timer = setTimeout(() => {
        const card = choosePlay(gs.hands[turn], gs.trick, gs.trump, turn)
        this.applyPlay(turn, card)
        this.onChange()
        this.schedule()
      }, BOT_PLAY_MS)
    }
  }

  // ---------- 个性化视图 ----------

  viewFor(userId: string | null): ViewState {
    const mySeat = userId ? this.seatOf(userId) : null
    const gs = this.gs
    const players = {} as Record<Seat, SeatPlayerInfo>
    for (const s of SEATS) {
      const h = this.seats[s]
      players[s] = h
        ? { name: h.name + (h.managed ? '·托管' : ''), bot: h.kind === 'bot' || !!h.managed, color: h.color, online: h.online, managed: !!h.managed }
        : { name: '', bot: false }
    }

    const base: ViewState = {
      tableId: this.id,
      tableName: this.name,
      system: this.system,
      scoring: this.scoring,
      boards: this.boards,
      boardNo: this.boardNo,
      phase: this.started && gs ? gs.phase : 'lobby',
      dealer: gs?.dealer ?? 'N',
      vul: gs?.vul ?? 'none',
      turn: gs?.turn ?? null,
      players,
      mySeat,
      myHand: mySeat && gs ? gs.hands[mySeat] : [],
      dummySeat: null,
      dummyHand: null,
      allHands: null,
      counts: gs ? { N: gs.hands.N.length, E: gs.hands.E.length, S: gs.hands.S.length, W: gs.hands.W.length } : { N: 13, E: 13, S: 13, W: 13 },
      auction: gs?.auction ?? [],
      contract: gs?.contract ?? null,
      trump: gs?.trump ?? null,
      trick: gs?.trick ?? [],
      tricksNS: gs?.tricksNS ?? 0,
      tricksEW: gs?.tricksEW ?? 0,
      scores: this.scores,
      result: gs?.result ?? null,
      myTurn: false,
      legalPlayIds: [],
      canStart: !this.started && mySeat !== null,
      gameOver: !!gs && gs.phase === 'scored' && this.boardNo >= this.boards,
      passedOut: gs?.passedOut ?? false,
    }

    if (!gs || !this.started) return base

    // 明手：按桥牌规则，首攻（第一张牌）打出后才摊牌，此前不下发明手牌
    if (gs.phase === 'play' || gs.phase === 'scored') {
      const dummy = partnerOf(gs.contract!.declarer)
      base.dummySeat = dummy
      base.dummyHand = this.dummyRevealed() ? gs.hands[dummy] : null
    }
    if (gs.phase === 'scored') base.allHands = gs.origHands // 回顾展示本副发牌

    // 代打视图：我是明手且庄家是纯 AI → 可代打；已开启 → 庄家的牌对我可见
    if ((gs.phase === 'play' || gs.phase === 'scored') && mySeat !== null && gs.contract) {
      const declarer = gs.contract.declarer
      const dummy = partnerOf(declarer)
      const dh = this.seats[declarer]
      base.canProxy = gs.phase === 'play' && mySeat === dummy && !!dh && dh.kind === 'bot' && !dh.managed
      base.proxyOn = this.proxyBy === userId
      base.proxySeat = base.proxyOn ? declarer : null
      base.proxyHand = base.proxyOn ? gs.hands[declarer] : null
    }

    // 我的行动权
    if (mySeat !== null) {
      if (gs.phase === 'bidding') {
        base.myTurn = gs.turn === mySeat
      } else if (gs.phase === 'play' && gs.trick.length < 4) {
        const dummy = partnerOf(gs.contract!.declarer)
        const decider = gs.turn === dummy ? gs.contract!.declarer : gs.turn
        const proxied = this.proxyBy === userId && (gs.turn === gs.contract!.declarer || gs.turn === dummy)
        base.myTurn = decider === mySeat || proxied
        if (base.myTurn) {
          base.legalPlayIds = legalPlays(gs.hands[gs.turn], gs.trick).map(cardId)
        }
      }
    }
    return base
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
  }
}

// ---------------------------------------------------------------------------
// 牌桌管理器

export class TableManager {
  rooms = new Map<string, Room>()
  private listeners = new Set<() => void>()
  private humanSockets = new Map<string, number>() // userId -> 在线连接数

  constructor() {
    // 预置牌桌（与单机版大厅一致，座位上先放 AI）
    for (const t of initialTables()) {
      const room = new Room({
        id: t.id,
        name: t.name,
        kind: t.kind,
        system: t.system,
        scoring: t.scoring,
        boards: t.boards,
        onChange: () => this.emitChange(),
      })
      t.seats.forEach((s, i) => {
        if (s?.startsWith('bot-')) {
          const b = BOTS.find((x) => x.id === s)!
          room.seats[SEATS[i]] = { kind: 'bot', name: b.name, color: b.color, online: true }
        }
      })
      this.rooms.set(t.id, room)
    }
  }

  createTable(owner: PublicUser, opts: { name: string; system: BiddingSystem; scoring: ScoringMode; boards: number; kind: TableKind }): Room {
    const id = 't-' + Math.random().toString(36).slice(2, 8)
    const room = new Room({ id, ...opts, onChange: () => this.emitChange() })
    this.rooms.set(id, room)
    room.join(owner)
    this.emitChange()
    return room
  }

  summaries(): TableSummary[] {
    // 隐藏房（每日赛）不进大厅列表
    return [...this.rooms.values()].filter((r) => !r.hidden).map((r) => r.summary())
  }

  socketOpened(userId: string) {
    const n = (this.humanSockets.get(userId) ?? 0) + 1
    this.humanSockets.set(userId, n)
    for (const r of this.rooms.values()) {
      if (r.seatOf(userId)) {
        r.reconnect(userId)
        this.emitChange()
        return
      }
    }
  }

  socketClosed(userId: string) {
    const n = (this.humanSockets.get(userId) ?? 1) - 1
    if (n > 0) {
      this.humanSockets.set(userId, n)
      return
    }
    this.humanSockets.delete(userId)
    let changed = false
    for (const r of this.rooms.values()) {
      if (r.seatOf(userId)) {
        r.disconnect(userId)
        changed = true
      }
    }
    // 回收空房间（保留预置桌）
    for (const [id, r] of this.rooms) {
      if (r.disposable && !id.match(/^t-10\d$/)) {
        r.destroy()
        this.rooms.delete(id)
        changed = true
      }
    }
    if (changed) this.emitChange()
  }

  onLobbyChange(fn: () => void) {
    this.listeners.add(fn)
  }

  offLobbyChange(fn: () => void) {
    this.listeners.delete(fn)
  }

  private emitChange() {
    for (const fn of this.listeners) fn()
  }
}
