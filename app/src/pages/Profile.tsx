import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Trophy, Gamepad2, TrendingUp, CalendarDays } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useState } from 'react'
import { AuthDialog } from '@/components/AuthDialog'
import { todayEvent } from '@/lib/data'

export default function Profile() {
  const { user, entries } = useStore()
  const [authOpen, setAuthOpen] = useState(!user)

  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-dashed p-10 text-center">
        <p className="text-muted-foreground">登录后查看个人战绩。</p>
        <Button className="mt-4 bg-emerald-700 hover:bg-emerald-600" onClick={() => setAuthOpen(true)}>登录 / 注册</Button>
        <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
      </div>
    )
  }

  const event = todayEvent()
  const myEntries = entries[event.id] ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <Avatar className="h-16 w-16">
            <AvatarFallback style={{ backgroundColor: user.color }} className="text-2xl text-white">
              {user.nickname.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{user.nickname}</h1>
            <p className="text-sm text-muted-foreground">@{user.username} · 注册于 {user.createdAt.slice(0, 10)}</p>
          </div>
          <Badge className="ml-auto bg-emerald-700">桥牌汇牌手</Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-1 p-4">
            <TrendingUp className="h-5 w-5 text-emerald-700" />
            <div className="text-2xl font-bold tabular-nums">{user.rating}</div>
            <div className="text-xs text-muted-foreground">等级分</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center gap-1 p-4">
            <Gamepad2 className="h-5 w-5 text-emerald-700" />
            <div className="text-2xl font-bold tabular-nums">{user.gamesPlayed}</div>
            <div className="text-xs text-muted-foreground">已完赛场次</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center gap-1 p-4">
            <Trophy className="h-5 w-5 text-amber-500" />
            <div className="text-2xl font-bold tabular-nums">{user.bestPct > 0 ? `${user.bestPct}%` : '—'}</div>
            <div className="text-xs text-muted-foreground">最佳百分比</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" /> 今日赛事进度
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {event.title}：已录入 {myEntries.length}/{event.boards.length} 副
          </span>
          <Button asChild size="sm" className="bg-emerald-700 hover:bg-emerald-600">
            <Link to="/event/daily">{myEntries.length > 0 ? '继续比赛' : '去参赛'}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
