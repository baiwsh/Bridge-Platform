// 联机版每日双人赛：牌局在服务端进行（固定种子全场同牌），成绩跨玩家持久化排名
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Trophy, CalendarDays, CheckCircle2, Medal, Play, Users, Wifi } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useSocket } from '@/lib/socket'
import OnlineGameTable from '@/components/OnlineGameTable'
import { BoardCompare } from './DailyEventLocal'
import { VUL_LABEL } from '@/lib/bridge'
import { cn } from '@/lib/utils'

export default function DailyEventOnline() {
  const { user } = useStore()
  const { connected, view, daily, send, lastError } = useSocket()
  const [playing, setPlaying] = useState<number | null>(null)
  const [activeBoard, setActiveBoard] = useState(1)

  // 进入页面 / 重连后拉取赛事状态
  useEffect(() => {
    if (connected) send({ t: 'daily' })
  }, [connected, send])

  const playingTableId = daily && playing !== null && user ? `daily-${daily.date}-${user.id}-${playing}` : null
  const inGame = !!playingTableId && view?.tableId === playingTableId

  const exitGame = () => {
    setPlaying(null)
    send({ t: 'daily' })
  }

  if (!connected || !daily) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        <Wifi className="mx-auto mb-2 h-6 w-6 animate-pulse" />
        正在连接赛事服务器…
      </div>
    )
  }

  if (inGame && playingTableId) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trophy className="h-4 w-4 text-amber-500" />
          {daily.title} · 第 {playing} 副（你坐南，搭档是 AI，对手为 AI；成绩按南北计入全场排名）
        </div>
        <OnlineGameTable tableId={playingTableId} onExit={exitGame} />
      </div>
    )
  }

  const myMp = daily.boards.reduce((s, b) => s + (b.mp ?? 0), 0)
  const myMax = daily.boards.reduce((s, b) => s + (b.maxMp ?? 0), 0)
  const runningPct = myMax > 0 ? (myMp / myMax) * 100 : 0
  const finished = daily.myDone >= daily.boards.length
  const myRank = daily.leaderboard.find((l) => l.you)
  const active = daily.boards.find((b) => b.board === activeBoard) ?? daily.boards[0]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400 text-emerald-950">
          <Trophy className="h-6 w-6" />
        </div>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {daily.title}
            <Badge className="bg-emerald-700">{daily.boards.length} 副</Badge>
            <Badge variant="outline">{daily.system === 'precision' ? '精确制' : '自然制'}</Badge>
            <Badge variant="outline" className="border-emerald-600 text-emerald-700 dark:text-emerald-300">
              <Wifi className="mr-1 h-3 w-3" /> 联机
            </Badge>
          </h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> 全场 {daily.fieldSize} 对 · 真人上手打 · 同一副牌全场相同 · MP 跨玩家排名
          </p>
        </div>
        <div className="ml-auto w-44">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>进度</span>
            <span>{daily.myDone}/{daily.boards.length}{daily.myDone > 0 && ` · ${runningPct.toFixed(1)}%`}</span>
          </div>
          <Progress value={(daily.myDone / daily.boards.length) * 100} />
        </div>
      </div>

      {finished && daily.myPct !== null && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>
              今日已完赛：全场百分比 <b className="text-emerald-700 dark:text-emerald-300">{daily.myPct.toFixed(1)}%</b>
              {myRank && <>，总排名 <b>{myRank.rank}</b>/{daily.leaderboard.length}</>}
              ，成绩已记入<Link to="/profile" className="underline">个人中心</Link>。明天再来！
            </span>
          </CardContent>
        </Card>
      )}
      {lastError && (
        <Card className="border-rose-300 bg-rose-50 dark:bg-rose-950/30">
          <CardContent className="p-3 text-sm text-rose-700 dark:text-rose-300">{lastError}</CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        {/* 左：牌副列表 */}
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">牌局列表（你坐南，与 AI 搭档坐南北）</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {daily.boards.map((b) => {
                const isActive = b.board === activeBoard
                return (
                  <div
                    key={b.board}
                    className={cn(
                      'rounded-lg border p-3 text-sm transition-colors',
                      isActive ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/40' : 'hover:bg-muted/60'
                    )}
                  >
                    <button onClick={() => setActiveBoard(b.board)} className="block w-full text-left">
                      <div className="flex items-center gap-2">
                        {b.played ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground">
                            {b.board}
                          </span>
                        )}
                        <span className="font-medium">第 {b.board} 副</span>
                        <Badge variant="outline" className="ml-auto text-xs">{VUL_LABEL[b.vul]}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        庄家 {b.dealer} ·{' '}
                        {b.played
                          ? `${b.contract} → ${(b.nsScore ?? 0) > 0 ? '+' : ''}${b.nsScore}（${b.mp}/${b.maxMp} MP）`
                          : b.hint}
                      </div>
                    </button>
                    {!b.played && (
                      <Button
                        size="sm"
                        className="mt-2 w-full bg-emerald-700 hover:bg-emerald-600"
                        onClick={() => {
                          setPlaying(b.board)
                          send({ t: 'dailyPlay', board: b.board })
                        }}
                      >
                        <Play className="mr-1 h-3.5 w-3.5" /> 开打本副
                      </Button>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            每副由你亲自叫牌、出牌（搭档与对手均为 AI）；每副成绩提交后不可修改，中途离开可稍后重打该副。
          </p>
        </div>

        {/* 右：单副对阵 / 总排行 */}
        <div className="space-y-4 lg:col-span-2">
          <BoardCompare eventId={daily.eventId} board={active.board} myScore={active.played ? active.nsScore ?? null : null} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Medal className="h-4 w-4 text-amber-500" /> 全场总排名（8 副累计 MP）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">名次</TableHead>
                    <TableHead>选手</TableHead>
                    <TableHead className="text-right">MP</TableHead>
                    <TableHead className="text-right">百分比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daily.leaderboard.map((l) => (
                    <TableRow key={l.pairId} className={l.you ? 'bg-amber-50 font-medium dark:bg-amber-950/30' : ''}>
                      <TableCell>{l.rank}</TableCell>
                      <TableCell>{l.name}{l.you && '（你）'}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.mp}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {daily.live.length > 0 && (
                <div className="mt-3 rounded-lg bg-muted/60 p-3">
                  <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> 进行中（完赛后进入总榜）
                  </div>
                  {daily.live.map((l) => (
                    <div key={l.name} className="flex justify-between text-xs">
                      <span className={cn(l.you && 'font-medium text-amber-700 dark:text-amber-300')}>{l.name}{l.you && '（你）'}</span>
                      <span className="tabular-nums text-muted-foreground">已打 {l.done}/8</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
