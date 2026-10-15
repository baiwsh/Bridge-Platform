import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Bot, Zap, Trophy, PlusCircle, Lock, LogIn, LogOut, Wifi, WifiOff, Eye, PlayCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useMaybeSocket } from '@/lib/socket'
import { AuthDialog } from '@/components/AuthDialog'
import {
  KIND_LABEL,
  SCORING_LABEL,
  SYSTEM_LABEL,
  seatDisplay,
  type BiddingSystem,
  type BridgeTable,
  type ScoringMode,
  type TableKind,
} from '@/lib/data'

const KIND_ICON: Record<TableKind, typeof Users> = { quick: Zap, friends: Users, bots: Bot, event: Trophy }

function SeatRow({ seats }: { seats: (string | null)[] }) {
  const dirs = ['北', '东', '南', '西']
  return (
    <div className="grid grid-cols-4 gap-1 text-center text-xs">
      {seats.map((s, i) => (
        <div key={i} className={s ? 'rounded bg-emerald-100 px-1 py-1 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100' : 'rounded border border-dashed px-1 py-1 text-muted-foreground'}>
          <div className="font-medium">{dirs[i]}</div>
          <div className="truncate">{s ? seatDisplay(s) : '空'}</div>
        </div>
      ))}
    </div>
  )
}

function TableCard({ t, onAuthNeeded, onJoin, onLeave, onWatch }: { t: BridgeTable; onAuthNeeded: () => void; onJoin?: (id: string) => void; onLeave?: (id: string) => void; onWatch?: (id: string) => void }) {
  const { user, joinTable, leaveTable } = useStore()
  const navigate = useNavigate()
  const seated = user ? t.seats.includes(user.nickname) : false
  const empty = t.seats.filter((s) => s === null).length
  const Icon = KIND_ICON[t.kind]

  const join = () => {
    if (!user) return onAuthNeeded()
    if (onJoin) onJoin(t.id)
    else joinTable(t.id)
  }

  const leave = () => {
    if (onLeave) onLeave(t.id)
    else leaveTable(t.id)
  }

  return (
    <Card className="border-emerald-900/10">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-800 text-amber-300">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{t.name}</span>
              {t.private && <Lock className="h-3 w-3 text-muted-foreground" />}
            </div>
            <div className="text-xs text-muted-foreground">{KIND_LABEL[t.kind]} · {t.boards} 副</div>
          </div>
          <Badge variant={t.status === 'waiting' ? 'default' : 'secondary'} className={t.status === 'waiting' ? 'bg-emerald-600' : ''}>
            {t.status === 'waiting' ? `等人 ${4 - empty}/4` : t.status === 'playing' ? '对局中' : '已满'}
          </Badge>
        </div>

        <div className="flex gap-1.5">
          <Badge variant="outline" className="text-xs">{SYSTEM_LABEL[t.system]}</Badge>
          <Badge variant="outline" className="text-xs">{SCORING_LABEL[t.scoring]}</Badge>
          {t.private && t.code && <Badge variant="outline" className="text-xs">约战码 {t.code}</Badge>}
        </div>

        <SeatRow seats={t.seats} />

        <div className="flex gap-2">
          {seated ? (
            <>
              <Button size="sm" className="flex-1 bg-emerald-700 hover:bg-emerald-600" onClick={() => navigate(`/table/${t.id}`)}>
                进入牌桌
              </Button>
              <Button size="sm" variant="outline" onClick={leave}>
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" className="flex-1" disabled={empty === 0} onClick={join}>
                <LogIn className="mr-1 h-4 w-4" /> {empty === 0 ? '座位已满' : '入座'}
              </Button>
              {onWatch && (
                <Button size="sm" variant="outline" onClick={() => (user ? onWatch(t.id) : onAuthNeeded())}>
                  <Eye className="mr-1 h-4 w-4" /> 旁观
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function Lobby() {
  const { tables: localTables, user, createTable, online } = useStore()
  const socket = useMaybeSocket()
  const isOnline = online && !!socket?.connected && !!user
  const [authOpen, setAuthOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [pendingTable, setPendingTable] = useState<string | null>(null)
  const navigate = useNavigate()

  // 创建牌桌表单
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TableKind>('quick')
  const [system, setSystem] = useState<BiddingSystem>('natural')
  const [scoring, setScoring] = useState<ScoringMode>('mp')
  const [boards, setBoards] = useState('8')
  const [isPrivate, setIsPrivate] = useState(false)

  // 联机模式：牌桌列表来自服务端
  const tables: BridgeTable[] = isOnline
    ? socket!.tables.map((s) => ({ ...s, private: false }))
    : localTables

  const filtered = tables.filter((t) => (filter === 'all' ? true : t.kind === filter))

  // 联机创建后，等大厅广播出现新桌再跳转入座
  useEffect(() => {
    if (!isOnline || !pendingTable || !user) return
    const mine = socket!.tables.find((t) => t.name === pendingTable && t.seats.includes(user.nickname))
    if (mine) {
      setPendingTable(null)
      navigate(`/table/${mine.id}`)
    }
  }, [isOnline, pendingTable, socket?.tables, user, navigate])

  const quickStart = () => {
    if (!user) return setAuthOpen(true)
    const t = tables.find((x) => x.kind === 'quick' && x.status === 'waiting')
    if (t) {
      if (isOnline) socket!.send({ t: 'join', tableId: t.id })
      navigate(`/table/${t.id}`)
    } else setCreateOpen(true)
  }

  const doCreate = () => {
    if (!user) return setAuthOpen(true)
    const tableName = name.trim() || `${user.nickname} 的牌桌`
    if (isOnline) {
      socket!.send({ t: 'create', name: tableName, system, scoring, boards: parseInt(boards), kind })
      setPendingTable(tableName)
      setCreateOpen(false)
      return
    }
    const code = isPrivate ? String(Math.floor(1000 + Math.random() * 9000)) : undefined
    const t = createTable({
      name: tableName,
      kind,
      system,
      scoring,
      boards: parseInt(boards),
      private: isPrivate,
      code,
    })
    setCreateOpen(false)
    navigate(`/table/${t.id}`)
  }

  const onlineJoin = (id: string) => {
    socket!.send({ t: 'join', tableId: id })
    navigate(`/table/${id}`)
  }
  const onlineLeave = (_id: string) => socket!.send({ t: 'leave' })
  const onlineWatch = (id: string) => navigate(`/table/${id}`)

  // 我仍在座位上的牌桌（断线托管保留席位，重新登录后可一键回去）
  const activeView = isOnline && socket!.view && socket!.view.mySeat != null ? socket!.view : null

  return (
    <div className="space-y-5">
      {activeView && (
        <Card className="border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <PlayCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 text-sm">
              你正在 <b>「{activeView.tableName}」</b>
              {activeView.phase === 'lobby' ? ' 等待开局' : ' 的对局中'}
              {activeView.tableId.startsWith('daily-') ? '（每日双人赛）' : ''}
            </div>
            <Button
              size="sm"
              className="bg-amber-400 text-emerald-950 hover:bg-amber-300"
              onClick={() => navigate(activeView.tableId.startsWith('daily-') ? '/event/daily' : `/table/${activeView.tableId}`)}
            >
              回到牌桌
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            活动大厅
            {isOnline ? (
              <Badge className="bg-emerald-600"><Wifi className="mr-1 h-3 w-3" /> 联机模式</Badge>
            ) : (
              <Badge variant="secondary"><WifiOff className="mr-1 h-3 w-3" /> 单机模式</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isOnline ? '真人联机：入座即同步，空位 AI 补满，掉线自动托管。' : '快速开始 · 好友约战 · 人机练习——选一张桌子入座，或创建自己的牌局。'}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button className="bg-amber-400 text-emerald-950 hover:bg-amber-300" onClick={quickStart}>
            <Zap className="mr-1 h-4 w-4" /> 快速开始
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" onClick={() => !user && setAuthOpen(true)}>
                <PlusCircle className="mr-1 h-4 w-4" /> 创建牌桌
              </Button>
            </DialogTrigger>
            {user && (
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>创建牌桌</DialogTitle>
                  <DialogDescription>选择玩法、叫牌体系与计分方式。私密约战会生成约战码分享给牌友。</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>牌桌名称</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${user.nickname} 的牌桌`} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>玩法</Label>
                    <RadioGroup value={kind} onValueChange={(v) => setKind(v as TableKind)} className="grid grid-cols-3 gap-2">
                      {(['quick', 'friends', 'bots'] as TableKind[]).map((k) => (
                        <Label key={k} className={`flex cursor-pointer items-center justify-center gap-1 rounded-md border p-2 text-sm ${kind === k ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/40' : ''}`}>
                          <RadioGroupItem value={k} className="sr-only" />
                          {KIND_LABEL[k]}
                        </Label>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="space-y-1.5">
                    <Label>叫牌体系</Label>
                    <RadioGroup value={system} onValueChange={(v) => setSystem(v as BiddingSystem)} className="grid grid-cols-2 gap-2">
                      <Label className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${system === 'natural' ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/40' : ''}`}>
                        <RadioGroupItem value="natural" className="sr-only" />
                        <span className="font-medium">自然制</span>
                        <span className="text-xs text-muted-foreground">五张高花 · 强无将 15–17</span>
                      </Label>
                      <Label className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${system === 'precision' ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/40' : ''}`}>
                        <RadioGroupItem value="precision" className="sr-only" />
                        <span className="font-medium">精确制</span>
                        <span className="text-xs text-muted-foreground">1♣ 强开叫 16+ · 限定叫</span>
                      </Label>
                    </RadioGroup>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>计分方式</Label>
                      <Select value={scoring} onValueChange={(v) => setScoring(v as ScoringMode)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mp">双人赛 · 比赛分 MP</SelectItem>
                          <SelectItem value="imp">队式赛 · IMP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>副数</Label>
                      <Select value={boards} onValueChange={setBoards}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['4', '8', '12', '16'].map((b) => (
                            <SelectItem key={b} value={b}>{b} 副</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="text-sm font-medium">私密约战</div>
                      <div className="text-xs text-muted-foreground">生成约战码，凭码入座</div>
                    </div>
                    <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                  </div>
                  <Button className="w-full bg-emerald-700 hover:bg-emerald-600" onClick={doCreate}>创建并入座</Button>
                </div>
              </DialogContent>
            )}
          </Dialog>
        </div>
      </div>

      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="all">全部牌桌</TabsTrigger>
          <TabsTrigger value="quick">快速开始</TabsTrigger>
          <TabsTrigger value="friends">好友约战</TabsTrigger>
          <TabsTrigger value="bots">人机练习</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((t) => (
          <TableCard
            key={t.id}
            t={t}
            onAuthNeeded={() => setAuthOpen(true)}
            onJoin={isOnline ? onlineJoin : undefined}
            onLeave={isOnline ? onlineLeave : undefined}
            onWatch={isOnline ? onlineWatch : undefined}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            该分类暂时没有牌桌，点击「创建牌桌」开一张吧。
          </div>
        )}
      </div>

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  )
}
