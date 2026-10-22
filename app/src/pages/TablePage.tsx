import { useParams, Link, useNavigate } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Bot, User, Trophy, BookOpen, Copy, Check, Play } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { useMaybeSocket } from '@/lib/socket'
import { AuthDialog } from '@/components/AuthDialog'
import GameTable, { type PlayerInfo } from '@/components/GameTable'
import OnlineGameTable from '@/components/OnlineGameTable'
import { KIND_LABEL, SCORING_LABEL, SYSTEM_LABEL, seatDisplay, BOTS } from '@/lib/data'
import type { Seat } from '@/lib/bridge'
import { SuitGlyph } from '@/components/chrome'
import { cn } from '@/lib/utils'

const DIR_CN = ['北', '东', '南', '西']
const SEATS: Seat[] = ['N', 'E', 'S', 'W']

export default function TablePage() {
  const { id } = useParams()
  const { tables, user, joinTable, leaveTable, recordCasualGame, online } = useStore()
  const socket = useMaybeSocket()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [game, setGame] = useState<{ players: Record<Seat, PlayerInfo>; userSeat: Seat } | null>(null)
  const table = tables.find((t) => t.id === id)
  const isOnline = online && !!socket?.connected && !!user

  // 联机模式：牌桌状态完全由服务端驱动
  if (isOnline && id) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/lobby')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> 大厅
          </Button>
          <h1 className="text-2xl font-bold">联机牌桌</h1>
          <Badge className="bg-emerald-600">真人联机</Badge>
        </div>
        <OnlineGameTable tableId={id} onExit={() => navigate('/lobby')} />
      </div>
    )
  }

  if (!table) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-muted-foreground">牌桌不存在或已解散。</p>
        <Button asChild variant="link" className="mt-2">
          <Link to="/lobby">返回活动大厅</Link>
        </Button>
      </div>
    )
  }

  const seated = user ? table.seats.includes(user.nickname) : false
  const empty = table.seats.filter((s) => s === null).length

  const copyCode = () => {
    if (table.code) {
      navigator.clipboard?.writeText(table.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  // 开始牌局：空位由 AI 补满；未入座则自动入座（满员时替换一个机器人）
  const startGame = () => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    const seats = [...table.seats]
    let userIdx = seats.indexOf(user.nickname)
    if (userIdx === -1) {
      const emptyIdx = seats.findIndex((s) => s === null)
      if (emptyIdx !== -1) {
        seats[emptyIdx] = user.nickname
        userIdx = emptyIdx
      } else {
        const botIdx = seats.findIndex((s) => s?.startsWith('bot-'))
        if (botIdx !== -1) {
          seats[botIdx] = user.nickname
          userIdx = botIdx
        }
      }
    }
    if (userIdx === -1) return
    const usedBots = new Set(seats.filter((s) => s?.startsWith('bot-')))
    const freeBots = BOTS.filter((b) => !usedBots.has(b.id))
    let bi = 0
    const players = {} as Record<Seat, PlayerInfo>
    SEATS.forEach((seat, i) => {
      const s = seats[i]
      if (s && s.startsWith('bot-')) {
        const b = BOTS.find((x) => x.id === s)!
        players[seat] = { name: b.name, bot: true, color: b.color }
      } else if (s) {
        players[seat] = { name: s, bot: false, color: user.color }
      } else {
        const b = freeBots[bi++ % freeBots.length]
        players[seat] = { name: b.name, bot: true, color: b.color }
      }
    })
    setGame({ players, userSeat: SEATS[userIdx] })
  }

  if (game) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setGame(null)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> 牌桌
          </Button>
          <h1 className="text-2xl font-bold">{table.name}</h1>
          <Badge variant="outline">{SYSTEM_LABEL[table.system]}</Badge>
          <Badge variant="outline">{SCORING_LABEL[table.scoring]}</Badge>
        </div>
        <GameTable
          players={game.players}
          userSeat={game.userSeat}
          system={table.system}
          scoring={table.scoring}
          boards={table.boards}
          onExit={() => setGame(null)}
          onFinish={() => recordCasualGame()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/lobby')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> 大厅
        </Button>
        <h1 className="text-2xl font-bold">{table.name}</h1>
        <Badge variant="outline">{SYSTEM_LABEL[table.system]}</Badge>
        <Badge variant="outline">{SCORING_LABEL[table.scoring]}</Badge>
        <Badge variant="secondary">{KIND_LABEL[table.kind]} · {table.boards} 副</Badge>
        {table.code && (
          <Button variant="outline" size="sm" onClick={copyCode}>
            {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
            约战码 {table.code}
          </Button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* 牌桌视觉 */}
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <div className="relative mx-auto aspect-square max-w-md">
              {/* 桌面 */}
              <div className="absolute inset-[18%] rounded-[2rem] bg-gradient-to-br from-emerald-700 to-emerald-800 shadow-inner ring-8 ring-amber-900/60">
                <div className="flex h-full flex-col items-center justify-center gap-1 text-emerald-100/70">
                  <div className="flex gap-2">
                    <SuitGlyph s="S" className="h-5 w-5 text-emerald-100" />
                    <SuitGlyph s="H" className="h-5 w-5" />
                    <SuitGlyph s="D" className="h-5 w-5" />
                    <SuitGlyph s="C" className="h-5 w-5 text-emerald-100" />
                  </div>
                  <div className="text-xs">{SYSTEM_LABEL[table.system]} · {SCORING_LABEL[table.scoring]}</div>
                </div>
              </div>
              {/* 四个座位 */}
              {table.seats.map((s, i) => {
                const pos = [
                  'left-1/2 top-0 -translate-x-1/2', // 北
                  'right-0 top-1/2 -translate-y-1/2', // 东
                  'left-1/2 bottom-0 -translate-x-1/2', // 南
                  'left-0 top-1/2 -translate-y-1/2', // 西
                ][i]
                const isBot = s?.startsWith('bot-')
                const isMe = user && s === user.nickname
                const bot = isBot ? BOTS.find((b) => b.id === s) : null
                return (
                  <div key={i} className={cn('absolute flex w-24 flex-col items-center gap-1', pos)}>
                    <div
                      className={cn(
                        'flex h-14 w-14 items-center justify-center rounded-full border-2 text-lg font-bold shadow',
                        s
                          ? isMe
                            ? 'border-amber-400 bg-emerald-600 text-white'
                            : 'border-emerald-700 bg-white text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'
                          : 'border-dashed border-muted-foreground/40 bg-background/60 text-muted-foreground'
                      )}
                      style={bot ? { backgroundColor: bot.color, color: '#fff', borderColor: 'transparent' } : undefined}
                    >
                      {s ? (isBot ? <Bot className="h-6 w-6" /> : <User className="h-6 w-6" />) : `${DIR_CN[i]}`}
                    </div>
                    <div className="rounded bg-background/90 px-2 py-0.5 text-xs shadow-sm">
                      {s ? seatDisplay(s) : `${DIR_CN[i]} · 空位`}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button className="bg-amber-400 text-emerald-950 hover:bg-amber-300" onClick={startGame}>
                <Play className="mr-1 h-4 w-4" /> 开始牌局（AI 补位）
              </Button>
              {seated ? (
                <Button variant="outline" onClick={() => { leaveTable(table.id); navigate('/lobby') }}>离开牌桌</Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={empty === 0}
                  onClick={() => (user ? joinTable(table.id) : setAuthOpen(true))}
                >
                  {empty === 0 ? '座位已满' : '只入座，稍后开'}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => navigate('/event/daily')}>
                <Trophy className="mr-1 h-4 w-4" /> 每日双人赛
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 牌局信息 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">牌局信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">玩法</span><span>{KIND_LABEL[table.kind]}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">叫牌体系</span><span>{SYSTEM_LABEL[table.system]}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">计分方式</span><span>{SCORING_LABEL[table.scoring]}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">副数</span><span>{table.boards}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">状态</span><span>{table.status === 'waiting' ? '等待牌手' : table.status === 'playing' ? '对局中' : '已满员'}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">本桌体系速览</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {table.system === 'natural' ? (
                <ul className="space-y-1">
                  <li>· 五张高花开叫（1♥/1♠ = 5 张以上，12–21 点）</li>
                  <li>· 1NT = 15–17 均型</li>
                  <li>· 2♣ 强牌人为逼叫，2 阶其余为弱二阻击</li>
                  <li>· 斯台曼、转移叫、黑木问 A</li>
                </ul>
              ) : (
                <ul className="space-y-1">
                  <li>· 1♣ = 16+ 强牌人为逼叫（核心叫品）</li>
                  <li>· 1♦ = 11–15，不保证实套；1NT = 13–15</li>
                  <li>· 高花开叫 11–15 且 5 张以上（限定叫）</li>
                  <li>· 控制问叫、阿尔法问叫支撑满贯探索</li>
                </ul>
              )}
              <Button asChild variant="link" size="sm" className="mt-2 h-auto p-0 text-emerald-700">
                <Link to="/systems"><BookOpen className="mr-1 h-3 w-3" /> 查看完整体系卡</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  )
}
