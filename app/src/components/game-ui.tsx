// 牌桌共享 UI 组件：本地单机（GameTable）与联机（OnlineGameTable）复用
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bot, User, RotateCcw, AlertCircle } from 'lucide-react'
import { STRAIN_LABEL, describeContract, type Seat, type Strain, type Vul } from '@/lib/bridge'
import { cardId, rankLabel, SUIT_LABEL, type CardT } from '@/lib/cards'
import { callRules, isArtificial, STRAIN_ORDER, type AuctionEntry, type Call, type FinalContract } from '@/lib/game'
import { callMeaning } from '@/lib/meanings'
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
  corner = 'stack',
  onClick,
}: {
  card?: CardT
  faceDown?: boolean
  small?: boolean
  playable?: boolean
  /** 角标排布：stack=点数在上、花色在下（横向牌堆，靠窄边可见）；inline=点数与花色同一行（纵向牌堆，靠顶部窄条可见） */
  corner?: 'stack' | 'inline'
  onClick?: () => void
}) {
  // 牌面尺寸：v1.8.0 起整体放大 50%（原 36×28 / 48×36 → 54×42 / 72×54），
  // 点数与花色字号同步放大；手机上大牌点数收 1 档（16px），
  // 让「点数+花色」角标在牌堆重叠时仍有完整可见宽度（v1.8.2）
  const size = small
    ? 'h-[54px] w-[42px] text-[15px] sm:h-[66px] sm:w-[48px] sm:text-[18px]'
    : 'h-[72px] w-[54px] text-[16px] sm:h-[84px] sm:w-[60px] sm:text-[21px]'
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
        // ring-inset：高亮描边画在牌内侧，不再向外扩张压住相邻牌的角标（v1.8.2）
        playable ? 'cursor-pointer ring-2 ring-inset ring-amber-400 hover:-translate-y-2' : onClick ? '' : 'cursor-default'
      )}
    >
      {/* 角标贴左上：横向牌堆纵向堆叠（窄）、纵向牌堆横向单行（扁），
          保证任何重叠幅度下每张牌的点数与花色都完整露在外面 */}
      <span
        className={cn(
          'absolute left-px top-0.5 flex leading-[1.05]',
          corner === 'inline' ? 'flex-row items-baseline gap-0.5' : 'flex-col items-center'
        )}
      >
        <span>{rankLabel(card.rank)}</span>
        <span>{SUIT_LABEL[card.suit]}</span>
      </span>
      {!small && (
        <span className="absolute bottom-1 right-1 rotate-180 leading-none opacity-60">{SUIT_LABEL[card.suit]}</span>
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
    <div className="absolute inset-x-0 bottom-[120px] flex max-h-[46%] justify-center sm:bottom-[146px] sm:max-h-[calc(100%-180px)]">
      <div ref={ref} className="flex max-h-full flex-col items-center gap-2 overflow-y-auto px-1 py-1">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 叫牌面板区块：桌面端显示完整「叫牌过程」面板；
// 手机端默认收起为一行摘要条（最近 4 个叫品），点开才展开完整面板——
// 避免浮层向上盖住顶部同伴的牌

export function AuctionSection({
  auction,
  dealer,
  system,
  waiting,
  onCallInfo,
}: {
  auction: AuctionEntry[]
  dealer: Seat
  system: BiddingSystem
  waiting?: string
  onCallInfo?: (idx: number) => void
}) {
  const [open, setOpen] = useState(false)
  const textOf = (c: Call): string => {
    if (c.type === 'pass') return 'Pass'
    if (c.type === 'X') return 'X'
    if (c.type === 'XX') return 'XX'
    return `${c.level}${STRAIN_LABEL[c.strain]}`
  }
  const recent = auction.slice(-4).map((a) => textOf(a.call)).join(' ')
  return (
    <>
      <div className="max-sm:hidden">
        <AuctionPanel auction={auction} dealer={dealer} system={system} waiting={waiting} onCallInfo={onCallInfo} />
      </div>
      <div className="flex flex-col items-center gap-1 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border bg-white/95 px-3 py-1 text-[11px] font-medium text-slate-700 shadow dark:bg-slate-900 dark:text-slate-200"
        >
          叫牌过程{recent ? ` · ${recent}` : ''}
          <span className="ml-1 text-slate-400">{open ? '▲收起' : '▼展开'}</span>
        </button>
        {open && <AuctionPanel auction={auction} dealer={dealer} system={system} waiting={waiting} onCallInfo={onCallInfo} />}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 叫品含义弹卡：点击任意叫品（面板格子或牌前卡条）弹出

export function CallInfoCard({
  auction,
  idx,
  system,
  onClose,
}: {
  auction: AuctionEntry[]
  idx: number
  system: BiddingSystem
  onClose: () => void
}) {
  const m = callMeaning(auction, idx, system)
  const seat = auction[idx]?.seat
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-emerald-950/40"
      onClick={onClose}
    >
      <div
        className="w-60 max-w-[calc(100vw-3rem)] rounded-xl border bg-white/95 p-3 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className={cn('text-lg font-extrabold', (m.title.includes('♥') || m.title.includes('♦')) && 'text-rose-600')}>
            {seat ? `${SEAT_CN[seat]} · ` : ''}{m.title}
          </span>
          {m.role && <Badge variant="outline" className="text-[10px]">{m.role}</Badge>}
        </div>
        <div className="mt-2 space-y-1">
          {m.lines.map((ln, i) => (
            <p key={i} className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">{ln}</p>
          ))}
        </div>
        <p className="mt-2 border-t pt-1.5 text-[10px] text-muted-foreground">
          参考含义 · 按{system === 'precision' ? '精确制' : '自然制'}体系卡 · 点空白处关闭
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 叫牌盘

export function BiddingBox({ auction, seat, onCall }: { auction: AuctionEntry[]; seat: Seat; onCall: (c: Call) => void }) {
  const rules = callRules(auction, seat)
  const [level, setLevel] = useState<number | null>(null)
  const rank = (l: number, s: Strain) => l * 5 + STRAIN_ORDER.indexOf(s)
  // 叫牌推进后清除已选阶数，避免跨轮残留
  useEffect(() => setLevel(null), [auction.length])

  const pick = (s: Strain) => {
    if (level === null) return
    onCall({ type: 'bid', level, strain: s })
    setLevel(null)
  }

  const lvBtn = (l: number) => {
    const usable = STRAIN_ORDER.some((s) => rank(l, s) >= rules.minBidRank)
    const selected = level === l
    return (
      <button
        key={l}
        disabled={!usable}
        onClick={() => setLevel(selected ? null : l)}
        className={cn(
          'h-7 w-7 rounded text-sm font-bold transition-colors sm:h-6 sm:w-6',
          !usable
            ? 'cursor-not-allowed text-slate-300 dark:text-slate-700'
            : selected
              ? 'bg-amber-400 text-emerald-950'
              : 'text-slate-800 hover:bg-emerald-50 dark:text-slate-200 dark:hover:bg-emerald-950'
        )}
      >
        {l}
      </button>
    )
  }

  return (
    <div className="rounded-xl border bg-white/95 px-2.5 py-2 shadow-xl dark:bg-slate-900">
      {/* 两段式叫牌：先选阶数，再选花色，版面仅为传统 35 格叫牌盘的 1/3 */}
      <div className="flex items-center justify-center gap-0.5">
        {[1, 2, 3, 4, 5, 6, 7].map(lvBtn)}
      </div>
      <div className="mt-1 flex items-center justify-center gap-0.5">
        {STRAIN_ORDER.map((s) => {
          const ok = level !== null && rank(level, s) >= rules.minBidRank
          return (
            <button
              key={s}
              disabled={!ok}
              onClick={() => pick(s)}
              className={cn(
                'h-7 rounded px-2 text-sm font-bold transition-colors sm:h-6 sm:text-xs',
                !ok
                  ? 'cursor-not-allowed text-slate-300 dark:text-slate-700'
                  : s === 'H' || s === 'D'
                    ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950'
                    : 'text-slate-800 hover:bg-emerald-50 dark:text-slate-200 dark:hover:bg-emerald-950'
              )}
            >
              {s === 'NT' ? 'NT' : STRAIN_LABEL[s]}
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-center gap-1.5">
        <Button size="sm" variant="outline" className="h-6 px-2.5 text-xs" onClick={() => onCall({ type: 'pass' })}>Pass</Button>
        <Button size="sm" variant="outline" className="h-6 px-2.5 text-xs text-rose-600" disabled={!rules.canX} onClick={() => onCall({ type: 'X' })}>加倍</Button>
        <Button size="sm" variant="outline" className="h-6 px-2.5 text-xs text-sky-600" disabled={!rules.canXX} onClick={() => onCall({ type: 'XX' })}>再加倍</Button>
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
  onCallInfo,
}: {
  auction: AuctionEntry[]
  dealer: Seat
  system: BiddingSystem
  onCallInfo?: (idx: number) => void
}) {
  const cells: ({ a: AuctionEntry; idx: number } | 'empty')[] = []
  const offset = { N: 0, E: 1, S: 2, W: 3 }[dealer]
  for (let i = 0; i < offset; i++) cells.push('empty')
  auction.forEach((a, idx) => cells.push({ a, idx }))

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
            title={onCallInfo ? '查看叫品含义' : undefined}
            onClick={onCallInfo ? () => onCallInfo(c.idx) : undefined}
            className={cn(
              'rounded py-0.5',
              onCallInfo && 'cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40',
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
  onCallInfo,
}: {
  auction: AuctionEntry[]
  dealer: Seat
  system: BiddingSystem
  contract?: FinalContract | null
  vul?: Vul
  waiting?: string
  onCallInfo?: (idx: number) => void
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
        <AuctionCells auction={auction} dealer={dealer} system={system} onCallInfo={onCallInfo} />
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

/** 单个叫品在座位前展示的样式数据 */
export interface CallChip {
  text: string
  red: boolean
  artificial: boolean
  idx: number // 在 auction 中的下标（用于查看含义）
}

/** 提取某个座位的全部叫品，转为牌前小卡条数据 */
export function seatCallChips(auction: AuctionEntry[], seat: Seat, system: BiddingSystem): CallChip[] {
  return auction
    .map((a, idx) => ({ a, idx }))
    .filter(({ a }) => a.seat === seat)
    .map(({ a, idx }) => {
      const c = a.call
      if (c.type === 'pass') return { text: 'Pass', red: false, artificial: false, idx }
      if (c.type === 'X') return { text: 'X', red: true, artificial: false, idx }
      if (c.type === 'XX') return { text: 'XX', red: true, artificial: false, idx }
      return {
        text: `${c.level}${STRAIN_LABEL[c.strain]}`,
        red: c.strain === 'H' || c.strain === 'D',
        artificial: isArtificial(c, system, true),
        idx,
      }
    })
}

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
  calls,
  onCallInfo,
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
  calls?: CallChip[] // 该座位已叫的叫品，展示在自己牌前（靠桌心一侧）
  onCallInfo?: (idx: number) => void // 点击叫品查看体系含义
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
  const cardSmall = !isUser && !userPlayTurn
  // 重叠幅度交给 CSS（index.css 的 .spread-*）：手机上按视口自适应，
  // 保证「13 张不溢出牌桌」且「每张牌的角标完整可见」，桌面沿用固定值。
  // 纵向座位（东/西）改用单行角标——纵向堆叠只有牌顶部一条窄区可见，
  // 纵向排布的花色会被下一张牌压住（v1.8.2）
  const corner: 'stack' | 'inline' = horizontal ? 'stack' : 'inline'
  const spreadCls = cn(
    horizontal ? 'spread-h' : 'spread-v flex-col',
    cardSmall ? 'spread-sm' : 'spread-lg',
    '[&>*:not(:first-child)]:ml-[var(--ovx,0px)] [&>*:not(:first-child)]:mt-[var(--ovy,0px)]'
  )
  const posCls = {
    bottom: 'bottom-1.5 left-1/2 -translate-x-1/2 flex-col items-center sm:bottom-2',
    top: 'top-14 left-1/2 -translate-x-1/2 flex-col items-center sm:top-9',
    left: 'left-1 top-1/2 -translate-y-1/2 flex-col items-start sm:left-2 sm:items-center',
    right: 'right-1 top-1/2 -translate-y-1/2 flex-col items-end sm:right-2 sm:items-center',
  }[pos]

  // 叫牌卡条：摆在手牌靠桌心一侧，像线下牌桌把叫牌卡放在自己面前
  const callStrip = calls && calls.length > 0 && (
    <div
      className={cn(
        'flex flex-wrap gap-0.5 rounded-md bg-emerald-950/40 p-0.5',
        horizontal ? 'max-w-[12rem] justify-center sm:max-w-[16rem]' : 'max-w-[5.5rem] sm:max-w-[7rem]'
      )}
    >
      {calls.map((c, i) =>
        onCallInfo ? (
          <button
            type="button"
            key={i}
            onClick={() => onCallInfo(c.idx)}
            title="查看叫品含义"
            className={cn(
              'rounded bg-white/90 px-1 py-px text-[9px] font-semibold leading-tight shadow hover:bg-amber-100 sm:text-[10px]',
              c.red ? 'text-rose-600' : 'text-slate-700'
            )}
          >
            {c.text}
            {c.artificial && <span className="ml-px text-amber-500">•</span>}
          </button>
        ) : (
          <span
            key={i}
            className={cn(
              'rounded bg-white/90 px-1 py-px text-[9px] font-semibold leading-tight shadow sm:text-[10px]',
              c.red ? 'text-rose-600' : 'text-slate-700'
            )}
          >
            {c.text}
            {c.artificial && <span className="ml-px text-amber-500" title="人为约定叫">•</span>}
          </span>
        )
      )}
    </div>
  )

  return (
    <div className={cn('absolute flex gap-1.5', posCls)}>
      {pos !== 'bottom' && nameTag}
      {pos === 'bottom' && callStrip}
      {faceUp && cards ? (
        // 明牌（自己 / 明手）：角标方向与堆叠方向匹配，保证每张牌的点数与花色可读
        <div className={cn('flex', spreadCls)}>
          {cards.map((c) => (
            <PlayingCard
              key={cardId(c)}
              card={c}
              small={cardSmall}
              corner={corner}
              playable={userPlayTurn && legalIds.has(cardId(c))}
              onClick={userPlayTurn && legalIds.has(cardId(c)) ? () => onPlay(c) : undefined}
            />
          ))}
          {cards.length === 0 && <div className="text-xs text-emerald-200/50">已出完</div>}
        </div>
      ) : (
        // 暗牌堆最多画 5 张且无角标，用固定重叠即可
        <div className={cn('flex items-center', horizontal ? '-space-x-[30px] sm:-space-x-[26px]' : 'flex-col -space-y-[40px] sm:-space-y-[50px]')}>
          {Array.from({ length: Math.min(cardCount, 5) }).map((_, i) => (
            <PlayingCard key={i} faceDown small />
          ))}
          <span className="z-10 ml-1 rounded-full bg-emerald-950/80 px-1.5 py-0.5 text-[10px] text-emerald-100">{cardCount}</span>
        </div>
      )}
      {pos !== 'bottom' && callStrip}
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
  onReview,
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
  onReview?: () => void // 收起结果卡，回顾刚打完的四家牌
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
      {onReview && (
        <Button size="sm" variant="ghost" className="mt-1.5 h-7 w-full text-xs text-emerald-700" onClick={onReview}>
          收起看牌 · 回顾本副四家牌
        </Button>
      )}
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
