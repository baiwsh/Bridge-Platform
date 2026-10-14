import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Bot, Trophy, CalendarDays, BookOpen, Calculator, ArrowRight, Spade, Heart, Diamond, Club } from 'lucide-react'
import { useStore } from '@/lib/store'
import { SYSTEM_LABEL, SCORING_LABEL, seatDisplay } from '@/lib/data'
import { todayEvent } from '@/lib/data'

const FEATURES = [
  {
    icon: Users,
    title: '好友约战',
    desc: '创建私密牌桌，把约战码发给搭档与对手，四人齐坐即刻开赛。',
  },
  {
    icon: Bot,
    title: '人机练习',
    desc: '与 AI 陪练对坐，熟悉精确制 / 自然制叫牌节奏，随时开桌无需等待。',
  },
  {
    icon: CalendarDays,
    title: '每日双人赛',
    desc: '每天 8 副牌，全场同牌竞技，比赛分（MP）排名，刷新你的最佳百分比。',
  },
  {
    icon: BookOpen,
    title: '两种叫牌体系',
    desc: '牌桌可选精确制或自然制，内置完整约定卡速查，体系不再靠记忆。',
  },
]

export default function Home() {
  const { tables, user } = useStore()
  const live = tables.slice(0, 4)
  const event = todayEvent()

  return (
    <div className="space-y-10">
      {/* Hero —— 参考 Trickster Cards 的 "Play Now" 风格 */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 px-6 py-14 text-emerald-50 sm:px-12">
        <div className="pointer-events-none absolute -right-6 -top-10 flex rotate-12 gap-3 opacity-20">
          <Spade className="h-32 w-32 fill-current" />
          <Heart className="h-24 w-24 fill-current text-rose-400" />
          <Diamond className="h-28 w-28 fill-current text-rose-400" />
          <Club className="h-24 w-24 fill-current" />
        </div>
        <Badge className="mb-4 bg-amber-400 text-emerald-950 hover:bg-amber-400">在线桥牌活动平台</Badge>
        <h1 className="max-w-xl text-4xl font-extrabold leading-tight sm:text-5xl">
          约上搭档，
          <br />
          来一局<span className="text-amber-300">桥牌</span>吧
        </h1>
        <p className="mt-4 max-w-lg text-emerald-100/80">
          免下载、打开浏览器即玩。快速匹配、好友约战、人机练习、每日双人赛——
          支持精确制与自然制两种叫牌体系，内置标准双人赛记分规则。
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-amber-400 text-emerald-950 hover:bg-amber-300">
            <Link to="/lobby">
              立即开打 <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-emerald-600 bg-transparent text-emerald-50 hover:bg-emerald-800 hover:text-emerald-50">
            <Link to={`/event/daily`}>
              <Trophy className="mr-1 h-4 w-4" /> 每日双人赛
            </Link>
          </Button>
        </div>
        <p className="mt-6 text-xs text-emerald-300/70">
          {user ? `欢迎回来，${user.nickname}！` : '注册账号即可参赛记分，30 秒完成。'} 今日赛事：{event.title} · 8 副牌 · {SYSTEM_LABEL[event.system]}
        </p>
      </section>

      {/* 功能入口 */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <Card key={f.title} className="border-emerald-900/10">
            <CardHeader className="pb-2">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-800 text-amber-300">
                <f.icon className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">{f.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{f.desc}</CardContent>
          </Card>
        ))}
      </section>

      {/* 进行中的牌桌 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">活动大厅实况</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/lobby">进入大厅 <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {live.map((t) => (
            <Card key={t.id} className="border-emerald-900/10">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-900">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    <Badge variant="outline" className="shrink-0 text-xs">{SYSTEM_LABEL[t.system]}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.seats.filter(Boolean).length}/4 人 · {SCORING_LABEL[t.scoring]} · {t.seats.filter(Boolean).map(seatDisplay).filter(Boolean).slice(0, 3).join('、') || '虚位以待'}
                  </div>
                </div>
                <Badge variant={t.status === 'waiting' ? 'default' : 'secondary'} className={t.status === 'waiting' ? 'bg-emerald-600' : ''}>
                  {t.status === 'waiting' ? '等人' : t.status === 'playing' ? '对局中' : '已满'}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* 工具入口 */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Card className="border-emerald-900/10 bg-gradient-to-br from-white to-emerald-50 dark:from-emerald-950 dark:to-emerald-900">
          <CardContent className="flex items-start gap-4 p-5">
            <Calculator className="mt-1 h-8 w-8 text-emerald-700" />
            <div>
              <h3 className="font-semibold">双人赛记分规则</h3>
              <p className="mt-1 text-sm text-muted-foreground">复式计分 + 比赛分（MP）换算，内置交互式计分器，输入定约与结果立即出分。</p>
              <Button asChild variant="link" className="mt-1 h-auto p-0 text-emerald-700">
                <Link to="/scoring">查看规则与计分器 <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-900/10 bg-gradient-to-br from-white to-emerald-50 dark:from-emerald-950 dark:to-emerald-900">
          <CardContent className="flex items-start gap-4 p-5">
            <BookOpen className="mt-1 h-8 w-8 text-emerald-700" />
            <div>
              <h3 className="font-semibold">叫牌体系速查</h3>
              <p className="mt-1 text-sm text-muted-foreground">精确制与自然制两套完整体系卡：开叫、应叫、常用约定一目了然。</p>
              <Button asChild variant="link" className="mt-1 h-auto p-0 text-emerald-700">
                <Link to="/systems">打开体系卡 <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
