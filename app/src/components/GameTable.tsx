// 单机牌桌（离线模式 / 本地练习）：引擎在浏览器本地运行
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { LogOut, Hand, RotateCcw } from 'lucide-react'
import {
  boardDealer,
  boardVul,
  contractScore,
  describeContract,
  nsImp,
  VUL_LABEL,
  seatPartnership,
  type Seat,
  type Vul,
} from '@/lib/bridge'
import { cardId, dealHands, hcp, type CardT, type Suit } from '@/lib/cards'
import {
  auctionOver,
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
} from '@/lib/game'
import type { BiddingSystem, ScoringMode } from '@/lib/data'
import type { ScoreRowMsg } from '@/lib/protocol'
import { AuctionSection, BiddingBox, BiddingOverlay, CallInfoCard, PlayingCard as PlayingCardView, ResultCard, SEAT_CN, SeatArea, seatCallChips, type SeatPlayer } from './game-ui'
import { cn } from '@/lib/utils'

export type PlayerInfo = SeatPlayer

interface GameState {
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

const SEATS: Seat[] = ['N', 'E', 'S', 'W']

/** 一墩收齐后停留多久再清台（与服务端 TRICK_CLEAR_MS 保持一致，便于看清四家出牌） */
const TRICK_CLEAR_MS = 3000

function freshBoard(boardNo: number): GameState {
  const hands = dealHands()
  return {
    hands,
    origHands: { N: [...hands.N], E: [...hands.E], S: [...hands.S], W: [...hands.W] },
    auction: [],
    phase: 'bidding',
    dealer: boardDealer(boardNo),
    turn: boardDealer(boardNo),
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

export default function GameTable({
  players,
  userSeat,
  system,
  scoring = 'mp',
  boards,
  onExit,
  onFinish,
}: {
  players: Record<Seat, PlayerInfo>
  userSeat: Seat
  system: BiddingSystem
  scoring?: ScoringMode
  boards: number
  onExit: () => void
  onFinish?: (nsTotal: number, ewTotal: number) => void
}) {
  const [boardNo, setBoardNo] = useState(1)
  const [gs, setGs] = useState<GameState>(() => freshBoard(1))
  const [scores, setScores] = useState<ScoreRowMsg[]>([])
  const [infoIdx, setInfoIdx] = useState<number | null>(null) // 查看叫品含义
  const [reviewing, setReviewing] = useState(false) // 收起结果卡回顾本副
  const [proxyOn, setProxyOn] = useState(false) // 代打 AI 同伴（庄家）
  const finishedRef = useRef(false)

  const dummySeat = gs.contract ? partnerOf(gs.contract.declarer) : null
  const decider: Seat = gs.phase === 'play' && gs.contract && dummySeat && gs.turn === dummySeat ? gs.contract.declarer : gs.turn
  // AI 同伴做庄时，明手（用户）可代打：庄家与明手的出牌都由用户决定
  const proxyTurn = proxyOn && gs.phase === 'play' && gs.contract !== null && (gs.turn === gs.contract.declarer || gs.turn === dummySeat)
  const canProxy = gs.phase === 'play' && gs.contract !== null && dummySeat === userSeat && players[gs.contract.declarer].bot
  // 桥牌规则：明手在首攻（第一张牌）打出之后才摊牌，此前即使是打牌阶段也保持暗牌
  const dummyRevealed = gs.trick.length > 0 || gs.tricksNS + gs.tricksEW > 0
  const faceUp = (seat: Seat) =>
    seat === userSeat ||
    gs.phase === 'scored' ||
    (gs.phase === 'play' && seat === dummySeat && dummyRevealed) ||
    (proxyOn && seat === gs.contract?.declarer)

  // 进入新一副后重置交互状态
  useEffect(() => {
    setReviewing(false)
    setInfoIdx(null)
    setProxyOn(false)
  }, [boardNo])

  // ---- 机器人叫牌 ----
  useEffect(() => {
    if (gs.phase !== 'bidding') return
    if (!players[gs.turn].bot) return
    const t = setTimeout(() => {
      setGs((prev) => applyBid(prev, chooseBid(prev.hands[prev.turn], prev.auction, prev.turn, system)))
    }, 650)
    return () => clearTimeout(t)
  }, [gs, players, system])

  // ---- 机器人打牌（决策者：庄家控制明手；用户代打时跳过庄家/明手） ----
  useEffect(() => {
    if (gs.phase !== 'play' || gs.trick.length === 4) return
    const turn = gs.turn
    if (proxyTurn) return
    if (!players[decider].bot) return
    const t = setTimeout(() => {
      setGs((prev) => {
        const card = choosePlay(prev.hands[turn], prev.trick, prev.trump, turn)
        return applyPlay(prev, turn, card)
      })
    }, 700)
    return () => clearTimeout(t)
  }, [gs, players, decider, proxyTurn])

  // ---- 一墩收齐后停顿 3 秒再清台，留出看清四家牌的时间 ----
  useEffect(() => {
    if (gs.trick.length !== 4) return
    const t = setTimeout(() => {
      setGs((prev) => ({ ...prev, trick: [] }))
    }, TRICK_CLEAR_MS)
    return () => clearTimeout(t)
  }, [gs.trick.length])

  function applyBid(prev: GameState, call: Call): GameState {
    const auction = [...prev.auction, { seat: prev.turn, call }]
    if (auctionOver(auction)) {
      const contract = getContract(auction)
      if (!contract) {
        const nb = freshBoard(boardNo)
        return { ...nb, passedOut: true }
      }
      const trump = contract.strain === 'NT' ? null : (contract.strain as Suit)
      return { ...prev, auction, phase: 'play', contract, trump, turn: nextSeat(contract.declarer), trick: [] }
    }
    return { ...prev, auction, turn: nextSeat(prev.turn) }
  }

  function applyPlay(prev: GameState, seat: Seat, card: CardT): GameState {
    const hand = prev.hands[seat].filter((c) => cardId(c) !== cardId(card))
    const trick = [...prev.trick, { seat, card }]
    const hands = { ...prev.hands, [seat]: hand }
    if (trick.length < 4) {
      return { ...prev, hands, trick, turn: nextSeat(seat) }
    }
    const winner = trickWinner(trick, prev.trump)
    const winNS = seatPartnership(winner) === 'NS'
    const tricksNS = prev.tricksNS + (winNS ? 1 : 0)
    const tricksEW = prev.tricksEW + (winNS ? 0 : 1)
    const done = hands.N.length === 0 && prev.contract !== null
    let result: ScoreRowMsg | null = null
    if (done && prev.contract) {
      const c = prev.contract
      const decTricks = seatPartnership(c.declarer) === 'NS' ? tricksNS : tricksEW
      const scored = contractScore({ level: c.level, strain: c.strain, doubled: c.doubled, declarer: c.declarer, tricks: decTricks, vul: prev.vul })
      const nsScore = seatPartnership(c.declarer) === 'NS' ? scored.score : -scored.score
      result = {
        board: boardNo,
        contract: describeContract({ level: c.level, strain: c.strain, doubled: c.doubled, declarer: c.declarer, tricks: decTricks, vul: prev.vul }),
        nsScore,
        tricksNS,
        tricksEW,
        imp: scoring === 'imp' ? nsImp(nsScore) : undefined,
      }
    }
    return { ...prev, hands, trick, turn: winner, tricksNS, tricksEW, phase: done ? 'scored' : 'play', result }
  }

  // ---- 一副结束后登入记分板（按副号去重） ----
  useEffect(() => {
    if (gs.phase === 'scored' && gs.result) {
      const r = gs.result
      setScores((rows) => (rows.some((x) => x.board === r.board && x.contract === r.contract) ? rows : [...rows, r]))
    }
  }, [gs.phase, gs.result])

  const nsTotal = scores.reduce((s, r) => s + r.nsScore, 0)
  const impMode = scoring === 'imp'
  const impTotal = impMode ? scores.reduce((s, r) => s + (r.imp ?? 0), 0) : 0
  const gameOver = gs.phase === 'scored' && boardNo >= boards

  useEffect(() => {
    if (gameOver && !finishedRef.current) {
      finishedRef.current = true
      onFinish?.(nsTotal, -nsTotal)
    }
    if (!gameOver) finishedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver])

  const nextBoard = () => {
    setBoardNo((n) => n + 1)
    setGs(freshBoard(boardNo + 1))
  }

  const restart = () => {
    setBoardNo(1)
    setScores([])
    setGs(freshBoard(1))
  }

  const posOf = (seat: Seat): 'bottom' | 'left' | 'top' | 'right' => {
    const rel = (SEATS.indexOf(seat) - SEATS.indexOf(userSeat) + 4) % 4
    return (['bottom', 'left', 'top', 'right'] as const)[rel]
  }

  const userBiddingTurn = gs.phase === 'bidding' && gs.turn === userSeat && !players[userSeat].bot
  const userPlayTurn = gs.phase === 'play' && gs.trick.length < 4 && (decider === userSeat || proxyTurn) && !players[userSeat].bot
  const activeLegal = userPlayTurn ? legalPlays(gs.hands[gs.turn], gs.trick) : []
  const turnLabel = gs.turn === userSeat ? '' : proxyTurn && gs.turn === gs.contract?.declarer ? '（代打庄家）' : '（明手）'

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="relative min-h-[520px] overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900 p-2 shadow-inner ring-4 ring-amber-900/50 sm:min-h-[680px] sm:p-3 sm:ring-8">
        <div className="absolute left-2 top-2 flex max-w-[62%] flex-wrap gap-1 sm:left-3 sm:top-3 sm:gap-1.5 [&>*]:max-sm:text-[10px]">
          <Badge className="bg-emerald-950/70 text-emerald-100">第 {boardNo}/{boards} 副</Badge>
          <Badge className="bg-emerald-950/70 text-emerald-100">{VUL_LABEL[gs.vul]}</Badge>
          <Badge className="bg-emerald-950/70 text-emerald-100">{SEAT_CN[gs.dealer]} 开叫</Badge>
          {gs.passedOut && <Badge className="bg-amber-500 text-emerald-950">上把流局 · 已重发</Badge>}
        </div>
        <div className="absolute right-2 top-2 flex max-w-[34%] flex-wrap justify-end gap-1 sm:right-3 sm:top-3 sm:gap-1.5 [&>*]:max-sm:text-[10px]">
          <Badge variant="outline" className="border-emerald-300/40 text-emerald-100">NS {gs.tricksNS} 墩</Badge>
          <Badge variant="outline" className="border-emerald-300/40 text-emerald-100">EW {gs.tricksEW} 墩</Badge>
        </div>

        {SEATS.map((seat) => (
          <SeatArea
            key={seat}
            seat={seat}
            pos={posOf(seat)}
            player={players[seat]}
            cards={gs.phase === 'scored' ? gs.origHands[seat] : faceUp(seat) ? gs.hands[seat] : null}
            faceUp={faceUp(seat)}
            cardCount={gs.hands[seat].length}
            active={gs.turn === seat && gs.phase !== 'scored'}
            userPlayTurn={userPlayTurn && gs.turn === seat}
            legalIds={new Set(activeLegal.map(cardId))}
            onPlay={(card) => setGs((prev) => applyPlay(prev, seat, card))}
            isUser={seat === userSeat}
            isDummy={seat === dummySeat && gs.phase === 'play'}
            hcp={seat === userSeat && gs.hands[seat].length > 0 ? hcp(gs.hands[seat]) : null}
            calls={seatCallChips(gs.auction, seat, system)}
            onCallInfo={setInfoIdx}
          />
        ))}

        {/* 叫牌阶段：面板与叫牌盘锚定在自己手牌上方，全程不遮挡手牌 */}
        {gs.phase === 'bidding' && (
          <BiddingOverlay>
            <AuctionSection
              auction={gs.auction}
              dealer={gs.dealer}
              system={system}
              waiting={userBiddingTurn ? undefined : `等待 ${SEAT_CN[gs.turn]} 叫牌…`}
              onCallInfo={setInfoIdx}
            />
            {userBiddingTurn && (
              <>
                <div className="text-center text-xs font-medium text-amber-300">轮到你叫牌</div>
                <BiddingBox auction={gs.auction} seat={userSeat} onCall={(c) => setGs((prev) => applyBid(prev, c))} />
              </>
            )}
          </BiddingOverlay>
        )}

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {gs.phase === 'bidding' ? null : gs.phase === 'scored' && gs.result ? (
            reviewing ? null : (
              <ResultCard
                row={gs.result}
                boardNo={boardNo}
                boards={boards}
                nsTotal={nsTotal}
                gameOver={gameOver}
                onNext={nextBoard}
                onRestart={restart}
                onExit={onExit}
                onReview={() => setReviewing(true)}
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2">
              {gs.contract && (
                <div className="rounded-full bg-emerald-950/80 px-3 py-1 text-xs whitespace-nowrap text-emerald-100 shadow">
                  定约 <b className={cn((gs.contract.strain === 'H' || gs.contract.strain === 'D') && 'text-rose-300')}>
                    {describeContract({ ...gs.contract, tricks: 0, vul: gs.vul }).split(' ').slice(0, -1).join(' ')}
                  </b> · {SEAT_CN[gs.contract.declarer]} 庄
                </div>
              )}
              {/* AI 同伴做庄：明手可代打本副 */}
              {gs.phase === 'play' && (canProxy || proxyOn) && (
                <Button
                  size="sm"
                  variant={proxyOn ? 'default' : 'outline'}
                  className={cn('h-7 px-2.5 text-xs', proxyOn ? 'bg-amber-400 text-emerald-950 hover:bg-amber-300' : 'border-amber-300/60 bg-emerald-950/60 text-amber-200 hover:bg-emerald-900')}
                  onClick={() => setProxyOn((v) => !v)}
                >
                  <Hand className="mr-1 h-3 w-3" />
                  {proxyOn ? '交还 AI 出牌' : '代打同伴（AI 庄家）'}
                </Button>
              )}
              <div className="relative h-[216px] w-[264px] sm:h-[264px] sm:w-[336px]">
                {gs.trick.map((p) => {
                  const pos = posOf(p.seat)
                  const offset = { bottom: 'left-1/2 top-[58%] -translate-x-1/2', top: 'left-1/2 top-[6%] -translate-x-1/2', left: 'left-[8%] top-1/2 -translate-y-1/2', right: 'right-[8%] top-1/2 -translate-y-1/2' }[pos]
                  return (
                    <div key={cardId(p.card)} className={cn('absolute', offset)}>
                      <PlayingCardView card={p.card} />
                    </div>
                  )
                })}
                {gs.trick.length === 0 && (
                  <div className="flex h-full items-center justify-center text-center text-xs text-emerald-200/60">
                    {userPlayTurn ? '轮到你出牌' : '对局进行中…'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {userPlayTurn && (
          <div className="absolute bottom-[128px] left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-bold whitespace-nowrap text-emerald-950 shadow sm:bottom-[160px] sm:px-3 sm:text-xs">
            轮到你{turnLabel}出牌 · 必须跟出{gs.trick.length > 0 ? '同' : '任意'}花色
          </div>
        )}

        {/* 回顾模式：收起结果卡后显示底部操作条 */}
        {gs.phase === 'scored' && reviewing && (
          <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-emerald-950/90 px-2 py-1.5 shadow-lg">
            <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-emerald-100 hover:bg-emerald-800" onClick={() => setReviewing(false)}>
              查看结果
            </Button>
            {gameOver ? (
              <Button size="sm" className="h-7 bg-amber-400 px-2.5 text-xs text-emerald-950 hover:bg-amber-300" onClick={restart}>
                <RotateCcw className="mr-1 h-3 w-3" /> 再来一局
              </Button>
            ) : (
              <Button size="sm" className="h-7 bg-amber-400 px-2.5 text-xs text-emerald-950 hover:bg-amber-300" onClick={nextBoard}>
                下一副（{boardNo + 1}/{boards}）
              </Button>
            )}
          </div>
        )}

        {/* 叫品含义弹卡 */}
        {infoIdx !== null && gs.auction[infoIdx] && (
          <CallInfoCard auction={gs.auction} idx={infoIdx} system={system} onClose={() => setInfoIdx(null)} />
        )}
      </div>

      <div className="space-y-3">
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 text-sm font-semibold">记分板（{impMode ? 'IMP' : '复式分'}）</div>
            {scores.length === 0 ? (
              <p className="text-xs text-muted-foreground">每副结束后记录南北得分。</p>
            ) : (
              <div className="space-y-1 text-xs">
                {scores.map((r) => (
                  <div key={r.board} className="flex items-center justify-between rounded bg-muted/60 px-2 py-1">
                    <span>#{r.board} {r.contract}</span>
                    <span className="flex items-center gap-2">
                      {impMode && (
                        <span className={cn('rounded bg-background px-1.5 py-0.5 font-bold tabular-nums', (r.imp ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {(r.imp ?? 0) > 0 ? '+' : ''}{r.imp ?? 0} IMP
                        </span>
                      )}
                      <span className={cn('font-bold tabular-nums', r.nsScore >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                        {r.nsScore > 0 ? '+' : ''}{r.nsScore}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex justify-between border-t pt-2 text-sm font-bold">
              <span>南北合计{impMode ? '（IMP）' : ''}</span>
              <span className={cn('tabular-nums', impMode && (impTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'))}>
                {impMode
                  ? `${impTotal >= 0 ? '+' : ''}${impTotal} IMP`
                  : `${nsTotal >= 0 ? '+' : ''}${nsTotal}`}
              </span>
            </div>
            {impMode && (
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>累计净分</span>
                <span className="tabular-nums">{nsTotal >= 0 ? '+' : ''}{nsTotal}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Button variant="outline" className="w-full" onClick={onExit}>
          <LogOut className="mr-1 h-4 w-4" /> 离开牌桌
        </Button>
      </div>
    </div>
  )
}
