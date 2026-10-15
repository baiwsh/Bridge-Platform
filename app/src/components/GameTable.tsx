// 单机牌桌（离线模式 / 本地练习）：引擎在浏览器本地运行
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { LogOut } from 'lucide-react'
import {
  boardDealer,
  boardVul,
  contractScore,
  describeContract,
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
import type { BiddingSystem } from '@/lib/data'
import type { ScoreRowMsg } from '@/lib/protocol'
import { AuctionPanel, BiddingBox, BiddingOverlay, PlayingCard as PlayingCardView, ResultCard, SEAT_CN, SeatArea, seatCallChips, type SeatPlayer } from './game-ui'
import { cn } from '@/lib/utils'

export type PlayerInfo = SeatPlayer

interface GameState {
  hands: Record<Seat, CardT[]>
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

function freshBoard(boardNo: number): GameState {
  return {
    hands: dealHands(),
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
  boards,
  onExit,
  onFinish,
}: {
  players: Record<Seat, PlayerInfo>
  userSeat: Seat
  system: BiddingSystem
  boards: number
  onExit: () => void
  onFinish?: (nsTotal: number, ewTotal: number) => void
}) {
  const [boardNo, setBoardNo] = useState(1)
  const [gs, setGs] = useState<GameState>(() => freshBoard(1))
  const [scores, setScores] = useState<ScoreRowMsg[]>([])
  const finishedRef = useRef(false)

  const dummySeat = gs.contract ? partnerOf(gs.contract.declarer) : null
  const decider: Seat = gs.phase === 'play' && gs.contract && dummySeat && gs.turn === dummySeat ? gs.contract.declarer : gs.turn
  const faceUp = (seat: Seat) =>
    seat === userSeat || gs.phase === 'scored' || (gs.phase === 'play' && seat === dummySeat)

  // ---- 机器人叫牌 ----
  useEffect(() => {
    if (gs.phase !== 'bidding') return
    if (!players[gs.turn].bot) return
    const t = setTimeout(() => {
      setGs((prev) => applyBid(prev, chooseBid(prev.hands[prev.turn], prev.auction, prev.turn, system)))
    }, 650)
    return () => clearTimeout(t)
  }, [gs, players, system])

  // ---- 机器人打牌（决策者：庄家控制明手） ----
  useEffect(() => {
    if (gs.phase !== 'play' || gs.trick.length === 4) return
    const turn = gs.turn
    if (!players[decider].bot) return
    const t = setTimeout(() => {
      setGs((prev) => {
        const card = choosePlay(prev.hands[turn], prev.trick, prev.trump, turn)
        return applyPlay(prev, turn, card)
      })
    }, 700)
    return () => clearTimeout(t)
  }, [gs, players, decider])

  // ---- 一墩收齐后停顿再清台 ----
  useEffect(() => {
    if (gs.trick.length !== 4) return
    const t = setTimeout(() => {
      setGs((prev) => ({ ...prev, trick: [] }))
    }, 1100)
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
      result = { board: boardNo, contract: describeContract({ level: c.level, strain: c.strain, doubled: c.doubled, declarer: c.declarer, tricks: decTricks, vul: prev.vul }), nsScore, tricksNS, tricksEW }
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
  const userPlayTurn = gs.phase === 'play' && gs.trick.length < 4 && decider === userSeat && !players[userSeat].bot
  const activeLegal = userPlayTurn ? legalPlays(gs.hands[gs.turn], gs.trick) : []

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="relative min-h-[430px] overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900 p-2 shadow-inner ring-4 ring-amber-900/50 sm:min-h-[560px] sm:p-3 sm:ring-8">
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
            cards={faceUp(seat) ? gs.hands[seat] : null}
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
          />
        ))}

        {/* 叫牌阶段：面板与叫牌盘锚定在自己手牌上方，全程不遮挡手牌 */}
        {gs.phase === 'bidding' && (
          <BiddingOverlay>
            <AuctionPanel
              auction={gs.auction}
              dealer={gs.dealer}
              system={system}
              waiting={userBiddingTurn ? undefined : `等待 ${SEAT_CN[gs.turn]} 叫牌…`}
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
            <ResultCard
              row={gs.result}
              boardNo={boardNo}
              boards={boards}
              nsTotal={nsTotal}
              gameOver={gameOver}
              onNext={nextBoard}
              onRestart={restart}
              onExit={onExit}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              {gs.contract && (
                <div className="rounded-full bg-emerald-950/80 px-3 py-1 text-xs whitespace-nowrap text-emerald-100 shadow">
                  定约 <b className={cn((gs.contract.strain === 'H' || gs.contract.strain === 'D') && 'text-rose-300')}>
                    {describeContract({ ...gs.contract, tricks: 0, vul: gs.vul }).split(' ').slice(0, -1).join(' ')}
                  </b> · {SEAT_CN[gs.contract.declarer]} 庄
                </div>
              )}
              <div className="relative h-36 w-44 sm:h-44 sm:w-56">
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
          <div className="absolute bottom-[104px] left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-bold whitespace-nowrap text-emerald-950 shadow sm:bottom-[132px] sm:px-3 sm:text-xs">
            轮到你{gs.turn !== userSeat ? '（明手）' : ''}出牌 · 必须跟出{gs.trick.length > 0 ? '同' : '任意'}花色
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 text-sm font-semibold">记分板（复式分）</div>
            {scores.length === 0 ? (
              <p className="text-xs text-muted-foreground">每副结束后记录南北得分。</p>
            ) : (
              <div className="space-y-1 text-xs">
                {scores.map((r) => (
                  <div key={r.board} className="flex items-center justify-between rounded bg-muted/60 px-2 py-1">
                    <span>#{r.board} {r.contract}</span>
                    <span className={cn('font-bold tabular-nums', r.nsScore >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      {r.nsScore > 0 ? '+' : ''}{r.nsScore}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex justify-between border-t pt-2 text-sm font-bold">
              <span>南北合计</span>
              <span className="tabular-nums">{nsTotal >= 0 ? '+' : ''}{nsTotal}</span>
            </div>
          </CardContent>
        </Card>

        <Button variant="outline" className="w-full" onClick={onExit}>
          <LogOut className="mr-1 h-4 w-4" /> 离开牌桌
        </Button>
      </div>
    </div>
  )
}
