// 牌桌共享 UI 组件：本地单机（GameTable）与联机（OnlineGameTable）复用
import { useEffect, useRef, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bot, User, RotateCcw, AlertCircle } from 'lucide-react'
import { STRAIN_LABEL, describeContract, type Seat, type Strain, type Vul } from '@/lib/bridge'
import { cardId, rankLabel, SUIT_LABEL, type CardT } from '@/lib/cards'
import { callRules, isArtificial, STRAIN_ORDER, type AuctionEntry, type Call, type FinalContract } from '@/lib/game'
import type { BiddingSystem } from '@/lib/data'
import type { ScoreRowMsg } from '@/lib/protocol'
import { cn } from '@/lib/utils'

export const SEAT_CN: Record<Seat, string> = { N: '北', E: '东', S: '南', W: '西' }

export interface SeatPlayer {
  name: string
  bot: boolean
  color?: string
}

// ---------------------------------------------------------------------------
// 牌面

export function PlayingCard({
  card,
  faceDown,
  small,
  playable,
  onClick,
}: {
  card?: CardT
  faceDown?: boolean
  small?: boolean
  playable?: boolean
  onClick?: () => void
}) {
  const size = small
    ? 'h-9 w-7 text-[10px] sm:h-11 sm:w-8 sm:text-xs'
    : 'h-12 w-9 text-xs sm:h-14 sm:w-10 sm:text-sm'
  if (faceDown || !card) {
    return (
      <div className={cn('rounded-md border border-emerald-950 bg-gradient-to-br from-emerald-700 to-emerald-900 shadow-sm', size)}>
        <div className="m-1 h-[calc(100%-8px)] rounded-sm border border-emerald-400/30" />
      </div>
    )
  }
  const red = card.suit === 'H' || card.suit === 'D'
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'relative rounded-md border bg-white font-bold shadow-sm transition-transform dark:bg-slate-100',
        size,
        red ? 'border-rose-300 text-rose-600' : 'border-slate-300 text-slate-800',
        playable ? 'cursor-pointer ring-2 ring-amber-400 hover:-translate-y-2' : onClick ? '' : 'cursor-default'
      )}
    >
      {/* 角标纵向堆叠：即使牌被遮挡，左侧窄条也能同时读出点数与花色 */}
      <span className="absolute left-0.5 top-0.5 flex flex-col items-center leading-[1.05]">
        <span>{rankLabel(card.rank)}</span>
        <span>{SUIT_LABEL[card.suit]}</span>
      </span>
      {!small && (
        <span className="absolute bottom-0.5 right-0.5 rotate-180 leading-none opacity-60">{SUIT_LABEL[card.suit]}</span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 叫牌浮层：锚定在玩家手牌上方，不遮挡手牌；内容过高时可滚动且默认滚到底部

export function BiddingOverlay({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // 内容变化后保持滚到底部（叫牌盘/操作按钮始终完整可见，早期叫品可上滑查看）
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  })
  return (
    <div className="absolute inset-x-0 bottom-[96px] flex max-h-[calc(100%-120px)] justify-center sm:bottom-[118px] sm:max-h-[calc(100%-140px)]">
      <div ref={ref} className="flex max-h-full flex-col items-center gap-2 overflow-y-auto px-1 py-1">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 叫牌盘

export function BiddingBox({ auction, seat, onCall }: { auction: AuctionEntry[]; seat: Seat; onCall: (c: Call) => void }) {
  const rules = callRules(auction, seat)
  const rank = (l: number, s: Strain) => l * 5 + STRAIN_ORDER.indexOf(s)
  return (
    <div className="rounded-xl border bg-white/95 p-2.5 shadow-xl sm:p-3 dark:bg-slate-900">
      <div className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5, 6, 7].flatMap((l) =>
          STRAIN_ORDER.map((s) => (
            <button
              key={`${l}${s}`}
              disabled={rank(l, s) < rules.minBidRank}
              onClick={() => onCall({ type: 'bid', level: l, strain: s })}
              className={cn(
                'rounded px-1 py-1.5 text-sm font-bold transition-colors sm:py-1',
                rank(l, s) < rules.minBidRank
                  ? 'cursor-not-allowed text-slate-300 dark:text-slate-700'
                  : s === 'H' || s === 'D'
                    ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950'
                    : 'text-slate-800 hover:bg-emerald-50 dark:text-slate-200 dark:hover:bg-emerald-950'
              )}
            >
              {l}
              {STRAIN_LABEL[s]}
            </button>
          ))
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        <Button size="sm" variant="outline" onClick={() => onCall({ type: 'pass' })}>Pass</Button>
        <Button size="sm" variant="outline" disabled={!rules.canX} className="text-rose-600" onClick={() => onCall({ type: 'X' })}>加倍 X</Button>
        <Button size="sm" variant="outline" disabled={!rules.canXX} className="text-sky-600" onClick={() => onCall({ type: 'XX' })}>再加倍 XX</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 叫牌记录

export function AuctionCells({
  auction,
  dealer,
  system,
}: {
  auction: AuctionEntry[]
  dealer: Seat
  system: BiddingSystem
}) {
  const cells: ({ a: AuctionEntry } | 'empty')[] = []
  const offset = { N: 0, E: 1, S: 2, W: 3 }[dealer]
  for (let i = 0; i < offset; i++) cells.push('empty')
  auction.forEach((a) => cells.push({ a }))

  const textOf = (a: AuctionEntry): { text: string; artificial: boolean } => {
    const c = a.call
    if (c.type === 'pass') return { text: 'Pass', artificial: false }
    if (c.type === 'X') return { text: 'X', artificial: false }
    if (c.type === 'XX') return { text: 'XX', artificial: false }
    return { text: `${c.level}${STRAIN_LABEL[c.strain]}`, artificial: isArtificial(c, system, true) }
  }

  return (
    <>
      {cells.map((c, i) =>
        c === 'empty' ? (
          <div key={i} />
        ) : (
          <div
            key={i}
            className={cn(
              'rounded py-0.5',
              c.a.call.type === 'bid'
                ? 'bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100'
                : 'text-muted-foreground'
            )}
          >
            {textOf(c.a).text}
            {textOf(c.a).artificial && (
              <span title="人为约定叫">
                <AlertCircle className="ml-0.5 inline h-2.5 w-2.5 text-amber-500" />
              </span>
            )}
          </div>
        )
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// 叫牌面板（牌桌中央显示）

export function AuctionPanel({
  auction,
  dealer,
  system,
  contract,
  vul,
  waiting,
}: {
  auction: AuctionEntry[]
  dealer: Seat
  system: BiddingSystem
  contract?: FinalContract | null
  vul?: Vul
  waiting?: string
}) {
  return (
    <div className="w-56 max-w-[calc(100vw-4rem)] rounded-xl border bg-white/95 p-2.5 shadow-xl sm:w-64 dark:bg-slate-900">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold">叫牌过程</span>
        <Badge variant="outline" className="text-[10px]">{system === 'precision' ? '精确制' : '自然制'}</Badge>
      </div>
      <div className="grid grid-cols-4 gap-1 text-center text-xs">
        {(['N', 'E', 'S', 'W'] as Seat[]).map((s) => (
          <div key={s} className={cn('rounded py-0.5 font-medium', s === dealer ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-muted')}>
            {SEAT_CN[s]}
          </div>
        ))}
        <AuctionCells auction={auction} dealer={dealer} system={system} />
      </div>
      {auction.length === 0 && !contract && (
        <div className="py-1 text-center text-[11px] text-muted-foreground">尚无叫品</div>
      )}
      {contract && vul !== undefined && (
        <div className="mt-1.5 rounded-lg bg-emerald-50 p-1.5 text-center text-xs dark:bg-emerald-900/40">
          定约：<b className={cn((contract.strain === 'H' || contract.strain === 'D') && 'text-rose-600')}>
            {describeContract({ ...contract, tricks: 0, vul }).split(' ').slice(0, -1).join(' ')}
          </b>
          <span className="text-muted-foreground">（{SEAT_CN[contract.declarer]} 庄）</span>
        </div>
      )}
      {!contract && waiting && (
        <div className="mt-1.5 text-center text-[11px] text-muted-foreground">{waiting}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 座位区域

export function SeatArea({
  seat,
  pos,
  player,
  cards,
  faceUp,
  cardCount,
  active,
  userPlayTurn,
  legalIds,
  onPlay,
  isUser,
  isDummy,
  hcp,
  onTakeover,
}: {
  seat: Seat
  pos: 'bottom' | 'left' | 'top' | 'right'
  player: SeatPlayer
  cards: CardT[] | null // null = 暗牌
  faceUp: boolean
  cardCount: number
  active: boolean
  userPlayTurn: boolean
  legalIds: Set<string>
  onPlay: (c: CardT) => void
  isUser: boolean
  isDummy: boolean
  hcp?: number | null // 自己手牌的大牌点
  onTakeover?: () => void // 旁观者接管该 AI 座位
}) {
  const nameTag = (
    <div
      className={cn(
        'flex max-w-[10rem] items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shadow sm:max-w-none sm:px-2.5 sm:text-xs',
        active ? 'bg-amber-400 text-emerald-950' : 'bg-emerald-950/70 text-emerald-100'
      )}
    >
      {player.bot ? <Bot className="h-3 w-3 shrink-0" /> : <User className="h-3 w-3 shrink-0" />}
      <span className="truncate">{SEAT_CN[seat]} · {player.name || '空位'}</span>
      {isDummy && <span className="shrink-0 text-[10px] opacity-70">（明手）</span>}
      {hcp != null && (
        <span className={cn(
          'shrink-0 rounded-full px-1.5 font-bold tabular-nums',
          active ? 'bg-emerald-950/80 text-amber-300' : 'bg-amber-400 text-emerald-950'
        )}>
          {hcp} 点
        </span>
      )}
      {onTakeover && (
        <button
          type="button"
          onClick={onTakeover}
          className="shrink-0 rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-bold text-emerald-950 shadow hover:bg-amber-400"
        >
          接管
        </button>
      )}
    </div>
  )

  const horizontal = pos === 'bottom' || pos === 'top'
  const posCls = {
    bottom: 'bottom-1.5 left-1/2 -translate-x-1/2 flex-col items-center sm:bottom-2',
    top: 'top-14 left-1/2 -translate-x-1/2 flex-col items-center sm:top-9',
    left: 'left-1 top-1/2 -translate-y-1/2 flex-col items-start sm:left-2 sm:items-center',
    right: 'right-1 top-1/2 -translate-y-1/2 flex-col items-end sm:right-2 sm:items-center',
  }[pos]

  return (
    <div className={cn('absolute flex gap-1.5', posCls)}>
      {pos !== 'bottom' && nameTag}
      {faceUp && cards ? (
        // 明牌（自己 / 明手）：缩小遮挡幅度，配合纵向角标保证每张牌可读
        <div className={cn('flex', horizontal ? '-space-x-3 sm:-space-x-1.5' : '-space-y-4 flex-col sm:-space-y-5')}>
          {cards.map((c) => (
            <PlayingCard
              key={cardId(c)}
              card={c}
              small={!isUser && !userPlayTurn}
              playable={userPlayTurn && legalIds.has(cardId(c))}
              onClick={userPlayTurn && legalIds.has(cardId(c)) ? () => onPlay(c) : undefined}
            />
          ))}
          {cards.length === 0 && <div className="text-xs text-emerald-200/50">已出完</div>}
        </div>
      ) : (
        <div className={cn('flex items-center', horizontal ? '-space-x-7 sm:-space-x-6' : 'flex-col -space-y-9')}>
          {Array.from({ length: Math.min(cardCount, 5) }).map((_, i) => (
            <PlayingCard key={i} faceDown small />
          ))}
          <span className="z-10 ml-1 rounded-full bg-emerald-950/80 px-1.5 py-0.5 text-[10px] text-emerald-100">{cardCount}</span>
        </div>
      )}
      {pos === 'bottom' && nameTag}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单副结果卡

export function ResultCard({
  row,
  boardNo,
  boards,
  nsTotal,
  gameOver,
  onNext,
  onRestart,
  onExit,
  spectator,
}: {
  row: ScoreRowMsg
  boardNo: number
  boards: number
  nsTotal: number
  gameOver: boolean
  onNext: () => void
  onRestart: () => void
  onExit: () => void
  spectator?: boolean
}) {
  return (
    <div className="w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border bg-white/95 p-4 text-center shadow-xl dark:bg-slate-900">
      <div className="text-xs text-muted-foreground">第 {row.board} 副结束</div>
      <div className="mt-1 text-lg font-bold">{row.contract}</div>
      <div className={cn('mt-1 text-2xl font-extrabold tabular-nums', row.nsScore >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
        南北 {row.nsScore > 0 ? '+' : ''}{row.nsScore}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">墩数 NS {row.tricksNS} : {row.tricksEW} EW</div>
      <div className="mt-2 border-t pt-2 text-sm">
        累计：<b className="tabular-nums">NS {nsTotal >= 0 ? '+' : ''}{nsTotal}</b>
      </div>
      {spectator ? (
        <div className="mt-3 space-y-2">
          {gameOver && (
            <div className="rounded-lg bg-amber-50 py-2 text-sm font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              {nsTotal > 0 ? `全场结束：南北胜（${nsTotal} : ${-nsTotal}）` : nsTotal < 0 ? `全场结束：东西胜（${-nsTotal} : ${nsTotal}）` : '全场结束：平局'}
            </div>
          )}
          <div className="text-xs text-muted-foreground">旁观模式 · 请等待牌手进入下一副</div>
          <Button size="sm" variant="outline" className="w-full" onClick={onExit}>退出旁观</Button>
        </div>
      ) : gameOver ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg bg-amber-50 py-2 text-sm font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            {nsTotal > 0 ? `全场结束：南北胜（${nsTotal} : ${-nsTotal}）` : nsTotal < 0 ? `全场结束：东西胜（${-nsTotal} : ${nsTotal}）` : '全场结束：平局'}
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 bg-emerald-700 hover:bg-emerald-600" onClick={onRestart}>
              <RotateCcw className="mr-1 h-3 w-3" /> 再来一局
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={onExit}>返回大厅</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="mt-3 w-full bg-emerald-700 hover:bg-emerald-600" onClick={onNext}>
          下一副（{boardNo + 1}/{boards}）
        </Button>
      )}
    </div>
  )
}
