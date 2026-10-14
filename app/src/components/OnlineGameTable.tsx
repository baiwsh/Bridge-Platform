// 联机牌桌：状态全部来自服务端推送的 ViewState，操作通过 WebSocket 发送
import { useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { LogOut, Play, Users, Wifi } from 'lucide-react'
import { VUL_LABEL, describeContract, type Seat } from '@/lib/bridge'
import { cardId, SUIT_LABEL, type CardT } from '@/lib/cards'
import { useSocket } from '@/lib/socket'
import { AuctionCells, BiddingBox, PlayingCard, ResultCard, SEAT_CN, SeatArea } from './game-ui'
import { cn } from '@/lib/utils'

const SEATS: Seat[] = ['N', 'E', 'S', 'W']
const DIR_CN: Seat[] = ['N', 'E', 'S', 'W']

export default function OnlineGameTable({ tableId, onExit }: { tableId: string; onExit: () => void }) {
  const { view, send, lastError, connected } = useSocket()

  // 打开牌桌页即订阅该桌视图（未入座也可看到大厅阶段）
  useEffect(() => {
    if (connected) send({ t: 'watch', tableId })
  }, [connected, tableId, send])

  const v = view && view.tableId === tableId ? view : null

  const nsTotal = useMemo(() => (v ? v.scores.reduce((s, r) => s + r.nsScore, 0) : 0), [v])

  if (!v) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        <Wifi className="mx-auto mb-2 h-6 w-6 animate-pulse" />
        正在连接牌桌…
      </div>
    )
  }

  const mySeat = v.mySeat
  const posOf = (seat: Seat): 'bottom' | 'left' | 'top' | 'right' => {
    const base = mySeat ?? 'S'
    const rel = (SEATS.indexOf(seat) - SEATS.indexOf(base) + 4) % 4
    return (['bottom', 'left', 'top', 'right'] as const)[rel]
  }

  // 每个座位可见的牌
  const cardsFor = (seat: Seat): { cards: CardT[] | null; faceUp: boolean } => {
    if (v.phase === 'scored' && v.allHands) return { cards: v.allHands[seat], faceUp: true }
    if (seat === mySeat) return { cards: v.myHand, faceUp: true }
    if ((v.phase === 'play' || v.phase === 'scored') && seat === v.dummySeat) return { cards: v.dummyHand, faceUp: true }
    return { cards: null, faceUp: false }
  }

  const legalIds = new Set(v.legalPlayIds)

  // ---------- 大厅阶段（未开始） ----------
  if (v.phase === 'lobby') {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-lg font-bold">
            <Users className="h-5 w-5 text-emerald-700" /> {v.tableName}
            <Badge variant="outline">{v.system === 'precision' ? '精确制' : '自然制'}</Badge>
            <Badge variant="outline">{v.scoring === 'mp' ? '双人赛 · MP' : '队式赛 · IMP'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
            {DIR_CN.map((seat) => {
              const p = v.players[seat]
              const mine = seat === mySeat
              return (
                <div key={seat} className={cn('rounded-lg border p-3', mine ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : p.name ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'border-dashed text-muted-foreground')}>
                  <div className="font-medium">{SEAT_CN[seat]}</div>
                  <div className="mt-1 truncate">{p.name || '空位'}</div>
                  {p.name && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {p.bot ? 'AI' : p.online === false ? '离线' : '真人'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">真人入座后任意玩家可开始；空位由 AI 自动补满，中途掉线自动 AI 托管、重连恢复。</p>
          <div className="flex gap-2">
            {mySeat === null ? (
              <Button className="bg-emerald-700 hover:bg-emerald-600" onClick={() => send({ t: 'join', tableId })}>入座</Button>
            ) : (
              <>
                <Button className="bg-amber-400 text-emerald-950 hover:bg-amber-300" onClick={() => send({ t: 'start' })}>
                  <Play className="mr-1 h-4 w-4" /> 开始牌局（AI 补位）
                </Button>
                <Button variant="outline" onClick={() => { send({ t: 'leave' }); onExit() }}>离开牌桌</Button>
              </>
            )}
            <Button variant="ghost" onClick={onExit}>返回大厅</Button>
          </div>
          {lastError && <p className="text-sm text-rose-600">{lastError}</p>}
        </CardContent>
      </Card>
    )
  }

  // ---------- 对局阶段 ----------
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="relative min-h-[430px] overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900 p-2 shadow-inner ring-4 ring-amber-900/50 sm:min-h-[560px] sm:p-3 sm:ring-8">
        <div className="absolute left-2 top-2 flex max-w-[62%] flex-wrap gap-1 sm:left-3 sm:top-3 sm:gap-1.5 [&>*]:max-sm:text-[10px]">
          <Badge className="bg-emerald-950/70 text-emerald-100">第 {v.boardNo}/{v.boards} 副</Badge>
          <Badge className="bg-emerald-950/70 text-emerald-100">{VUL_LABEL[v.vul]}</Badge>
          <Badge className="bg-emerald-950/70 text-emerald-100">{SEAT_CN[v.dealer]} 开叫</Badge>
          {v.passedOut && <Badge className="bg-amber-500 text-emerald-950">上把流局 · 已重发</Badge>}
          <Badge className="bg-emerald-950/70 text-emerald-300"><Wifi className="mr-1 h-3 w-3" />联机</Badge>
        </div>
        <div className="absolute right-2 top-2 flex max-w-[34%] flex-wrap justify-end gap-1 sm:right-3 sm:top-3 sm:gap-1.5 [&>*]:max-sm:text-[10px]">
          <Badge variant="outline" className="border-emerald-300/40 text-emerald-100">NS {v.tricksNS} 墩</Badge>
          <Badge variant="outline" className="border-emerald-300/40 text-emerald-100">EW {v.tricksEW} 墩</Badge>
        </div>

        {SEATS.map((seat) => {
          const { cards, faceUp } = cardsFor(seat)
          return (
            <SeatArea
              key={seat}
              seat={seat}
              pos={posOf(seat)}
              player={v.players[seat]}
              cards={cards}
              faceUp={faceUp}
              cardCount={v.counts[seat]}
              active={v.turn === seat && v.phase !== 'scored'}
              userPlayTurn={v.phase === 'play' && v.myTurn && v.turn === seat}
              legalIds={legalIds}
              onPlay={(card) => send({ t: 'play', card })}
              isUser={seat === mySeat}
              isDummy={seat === v.dummySeat && v.phase === 'play'}
            />
          )
        })}

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {v.phase === 'bidding' && v.myTurn && mySeat ? (
            <div className="w-64 max-w-[calc(100vw-4rem)] max-sm:-translate-y-8">
              <div className="mb-1 text-center text-xs font-medium text-amber-300">轮到你叫牌</div>
              <BiddingBox auction={v.auction} seat={mySeat} onCall={(call) => send({ t: 'bid', call })} />
            </div>
          ) : v.phase === 'scored' && v.result ? (
            <ResultCard
              row={v.result}
              boardNo={v.boardNo}
              boards={v.boards}
              nsTotal={nsTotal}
              gameOver={v.gameOver}
              onNext={() => send({ t: 'next' })}
              onRestart={() => send({ t: 'restart' })}
              onExit={() => { send({ t: 'leave' }); onExit() }}
            />
          ) : (
            <div className="relative h-36 w-44 sm:h-44 sm:w-56">
              {v.trick.map((p) => {
                const pos = posOf(p.seat)
                const offset = { bottom: 'left-1/2 top-[58%] -translate-x-1/2', top: 'left-1/2 top-[6%] -translate-x-1/2', left: 'left-[8%] top-1/2 -translate-y-1/2', right: 'right-[8%] top-1/2 -translate-y-1/2' }[pos]
                return (
                  <div key={cardId(p.card)} className={cn('absolute', offset)}>
                    <PlayingCard card={p.card} />
                  </div>
                )
              })}
              {v.trick.length === 0 && (
                <div className="flex h-full items-center justify-center text-center text-xs text-emerald-200/60">
                  {v.phase === 'bidding' ? '叫牌进行中…' : v.myTurn ? '轮到你出牌' : '对局进行中…'}
                </div>
              )}
            </div>
          )}
        </div>

        {v.phase === 'play' && v.myTurn && (
          <div className="absolute bottom-[104px] left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-bold whitespace-nowrap text-emerald-950 shadow sm:bottom-[132px] sm:px-3 sm:text-xs">
            轮到你{v.turn !== mySeat ? '（明手）' : ''}出牌
            {v.trick.length > 0 && ` · 必须跟出${SUIT_LABEL[v.trick[0].card.suit]}`}
          </div>
        )}

        {lastError && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-rose-600 px-3 py-1 text-xs text-white shadow">
            {lastError}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">叫牌过程</span>
              <Badge variant="outline" className="text-xs">{v.system === 'precision' ? '精确制' : '自然制'}</Badge>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center text-xs">
              {SEATS.map((s) => (
                <div key={s} className={cn('rounded py-0.5 font-medium', s === v.dealer ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-muted')}>
                  {SEAT_CN[s]}
                </div>
              ))}
              <AuctionCells auction={v.auction} dealer={v.dealer} system={v.system} />
            </div>
            {v.contract && (
              <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-center text-sm dark:bg-emerald-900/40">
                定约：<b className={cn((v.contract.strain === 'H' || v.contract.strain === 'D') && 'text-rose-600')}>
                  {describeContract({ ...v.contract, tricks: 0, vul: v.vul }).split(' ').slice(0, -1).join(' ')}
                </b>
                <span className="text-muted-foreground">（{SEAT_CN[v.contract.declarer]} 庄）</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="mb-2 text-sm font-semibold">记分板（复式分）</div>
            {v.scores.length === 0 ? (
              <p className="text-xs text-muted-foreground">每副结束后记录南北得分。</p>
            ) : (
              <div className="space-y-1 text-xs">
                {v.scores.map((r) => (
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

        <Button variant="outline" className="w-full" onClick={() => { send({ t: 'leave' }); onExit() }}>
          <LogOut className="mr-1 h-4 w-4" /> 离开牌桌
        </Button>
      </div>
    </div>
  )
}
