import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Trophy, CalendarDays, CheckCircle2, Circle, Medal } from 'lucide-react'
import { useStore } from '@/lib/store'
import { AuthDialog } from '@/components/AuthDialog'
import { ScoreCalculator, type ScoreCalcValue } from '@/components/ScoreCalculator'
import { simulateBoardResults, todayEvent } from '@/lib/data'
import { describeContract, matchpoints, VUL_LABEL, type ContractInput } from '@/lib/bridge'
import { cn } from '@/lib/utils'

/** 离线（单机）版每日双人赛：本地录入成绩，数据存在浏览器里 */
export default function DailyEventLocal() {
  const event = useMemo(() => todayEvent(), [])
  const { user, entries, saveEntry, removeEntry, finishEvent } = useStore()
  const [authOpen, setAuthOpen] = useState(false)
  const [activeBoard, setActiveBoard] = useState(1)
  const [pending, setPending] = useState<ScoreCalcValue | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const myEntries = entries[event.id] ?? []
  const done = myEntries.length
  const active = event.boards.find((b) => b.board === activeBoard)!
  const existing = myEntries.find((e) => e.board === activeBoard)

  // 全场排行榜：逐副计算比赛分并累加
  const leaderboard = useMemo(() => {
    if (done < event.boards.length) return null
    const totals = new Map<string, { name: string; mp: number; max: number }>()
    for (const b of event.boards) {
      const mine = myEntries.find((e) => e.board === b.board)!
      const results = simulateBoardResults(event.id, b.board, mine.nsScore)
      const mp = matchpoints(results, 'NS')
      for (const r of mp) {
        const cur = totals.get(r.pairId) ?? { name: r.name, mp: 0, max: 0 }
        cur.mp += r.mp
        cur.max += r.maxMp
        totals.set(r.pairId, cur)
      }
    }
    return [...totals.entries()]
      .map(([pairId, v]) => ({ pairId, ...v, pct: v.max > 0 ? (v.mp / v.max) * 100 : 0 }))
      .sort((a, b) => b.mp - a.mp)
      .map((v, i) => ({ ...v, rank: i + 1 }))
  }, [done, event, myEntries])

  const myRank = leaderboard?.find((l) => l.pairId === 'you')

  const submitBoard = () => {
    if (!user) return setAuthOpen(true)
    if (!pending) return
    saveEntry(event.id, {
      board: activeBoard,
      contract: describeContract(pending as ContractInput),
      nsScore: pending.score * (pending.declarer === 'N' || pending.declarer === 'S' ? 1 : -1),
    })
    setPending(null)
    const next = event.boards.find((b) => !myEntries.some((e) => e.board === b.board) && b.board !== activeBoard)
    if (next) setActiveBoard(next.board)
  }

  const submitEvent = () => {
    if (myRank) {
      finishEvent(event.id, myRank.pct)
      setSubmitted(true)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400 text-emerald-950">
          <Trophy className="h-6 w-6" />
        </div>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {event.title}
            <Badge className="bg-emerald-700">{event.boards.length} 副</Badge>
            <Badge variant="outline">{event.system === 'precision' ? '精确制' : '自然制'}</Badge>
          </h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> 全场 {event.fieldSize} 对 · 双人赛比赛分（MP）排名 · 同桌异牌同向比较
          </p>
        </div>
        <div className="ml-auto w-40">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>进度</span><span>{done}/{event.boards.length}</span>
          </div>
          <Progress value={(done / event.boards.length) * 100} />
        </div>
      </div>

      {!user && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>登录后成绩才会记入你的战绩与排行榜。</span>
            <Button size="sm" className="bg-amber-400 text-emerald-950 hover:bg-amber-300" onClick={() => setAuthOpen(true)}>登录 / 注册</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        {/* 左：牌局列表 + 录入 */}
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">牌局列表（你与搭档坐南北）</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {event.boards.map((b) => {
                const e = myEntries.find((x) => x.board === b.board)
                const isActive = b.board === activeBoard
                return (
                  <button
                    key={b.board}
                    onClick={() => setActiveBoard(b.board)}
                    className={cn(
                      'rounded-lg border p-3 text-left text-sm transition-colors',
                      isActive ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/40' : 'hover:bg-muted/60'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {e ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-medium">第 {b.board} 副</span>
                      <Badge variant="outline" className="ml-auto text-xs">{VUL_LABEL[b.vul]}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      庄家 {b.dealer} · {e ? `${e.contract} → ${e.nsScore > 0 ? '+' : ''}${e.nsScore}` : b.hint}
                    </div>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {existing ? (
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <div className="text-sm">
                  第 {activeBoard} 副已录入：<b>{existing.contract}</b>，南北得分{' '}
                  <b className={existing.nsScore >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                    {existing.nsScore > 0 ? '+' : ''}{existing.nsScore}
                  </b>
                </div>
                <Button size="sm" variant="outline" onClick={() => removeEntry(event.id, activeBoard)}>
                  重录
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <ScoreCalculator
                key={activeBoard}
                title={`录入第 ${activeBoard} 副成绩（${VUL_LABEL[active.vul]}）`}
                defaultVul={active.vul}
                onScore={setPending}
              />
              <Button className="w-full bg-emerald-700 hover:bg-emerald-600" disabled={!pending} onClick={submitBoard}>
                {user ? '确认录入本副成绩' : '登录后录入'}
              </Button>
            </>
          )}
        </div>

        {/* 右：单副对阵 / 总排行 */}
        <div className="space-y-4 lg:col-span-2">
          <BoardCompare
            eventId={event.id}
            board={activeBoard}
            myScore={existing?.nsScore ?? null}
          />

          {leaderboard && (
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
                    {leaderboard.map((l) => (
                      <TableRow key={l.pairId} className={l.pairId === 'you' ? 'bg-amber-50 font-medium dark:bg-amber-950/30' : ''}>
                        <TableCell>{l.rank}</TableCell>
                        <TableCell>{l.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.mp}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.pct.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {myRank && !submitted && (
                  <Button className="mt-3 w-full bg-amber-400 text-emerald-950 hover:bg-amber-300" onClick={submitEvent}>
                    <Trophy className="mr-1 h-4 w-4" /> 完赛并记入战绩（{myRank.pct.toFixed(1)}%）
                  </Button>
                )}
                {submitted && (
                  <p className="mt-3 text-center text-sm text-emerald-600">
                    已完赛！最终排名 {myRank?.rank}/{leaderboard.length}，可到 <Link to="/profile" className="underline">个人中心</Link> 查看战绩。
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  )
}

/** 单副牌的全场对阵表：你的成绩 vs 模拟其他各对，并显示本副 MP */
export function BoardCompare({ eventId, board, myScore }: { eventId: string; board: number; myScore: number | null }) {
  const results = useMemo(
    () => simulateBoardResults(eventId, board, myScore),
    [eventId, board, myScore]
  )
  const ranked = useMemo(() => (myScore === null ? null : matchpoints(results, 'NS')), [results, myScore])
  const mine = ranked?.find((r) => r.pairId === 'you')

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">第 {board} 副 · 全场对阵</CardTitle>
      </CardHeader>
      <CardContent>
        {myScore === null || myScore === undefined || Number.isNaN(myScore) ? (
          <p className="text-sm text-muted-foreground">录入本副成绩后，这里会显示你与全场各对的对比及本副比赛分。</p>
        ) : (
          <>
            {mine && (
              <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-900/40">
                本副你获得 <b className="text-emerald-700 dark:text-emerald-300">{mine.mp} / {mine.maxMp} MP</b>（{mine.pct.toFixed(0)}%）
                ，在 {ranked!.length} 对中暂列第 {mine.rank}。
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>选手</TableHead>
                  <TableHead>定约</TableHead>
                  <TableHead className="text-right">南北分</TableHead>
                  <TableHead className="text-right">MP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked!.map((r) => (
                  <TableRow key={r.pairId} className={r.pairId === 'you' ? 'bg-amber-50 font-medium dark:bg-amber-950/30' : ''}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-xs">{r.contract}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.nsScore > 0 ? '+' : ''}{r.nsScore}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.mp}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
