import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Trophy, Gamepad2, TrendingUp, CalendarDays, Pencil, Check, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useState } from 'react'
import { AuthDialog } from '@/components/AuthDialog'
import { todayEvent } from '@/lib/data'

export default function Profile() {
  const { user, entries, updateProfile, online } = useStore()
  const [authOpen, setAuthOpen] = useState(!user)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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

  const startEdit = () => {
    setDraft(user.nickname)
    setEditing(true)
    setMsg(null)
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    setMsg(null)
    const err = await updateProfile(draft)
    setBusy(false)
    if (err) {
      setMsg({ kind: 'err', text: err })
      return
    }
    setEditing(false)
    setMsg({ kind: 'ok', text: online ? '昵称已更新，牌桌显示名同步生效' : '昵称已更新（保存在本机）' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-6">
          <Avatar className="h-16 w-16">
            <AvatarFallback style={{ backgroundColor: user.color }} className="text-2xl text-white">
              {user.nickname.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold">{user.nickname}</h1>
            <p className="text-sm text-muted-foreground">@{user.username} · 注册于 {user.createdAt.slice(0, 10)}</p>
          </div>
          <Badge className="bg-emerald-700">桥牌汇牌手</Badge>
          {!editing && (
            <Button size="sm" variant="outline" className="gap-1" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" /> 修改昵称
            </Button>
          )}
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <Label htmlFor="nick-edit">昵称（牌桌显示名，1–16 个字符，支持中文）</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="nick-edit"
                value={draft}
                maxLength={16}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
                placeholder="输入新昵称"
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" className="gap-1 bg-emerald-700 hover:bg-emerald-600" disabled={busy} onClick={() => void save()}>
                  <Check className="h-3.5 w-3.5" /> {busy ? '保存中…' : '保存'}
                </Button>
                <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => { setEditing(false); setMsg(null) }}>
                  <X className="h-3.5 w-3.5" /> 取消
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              修改后个人中心、大厅与正在进行的牌桌座位名会立即更新；下次登录依然有效。
            </p>
          </CardContent>
        </Card>
      )}

      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>
      )}

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
