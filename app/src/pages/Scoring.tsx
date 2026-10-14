import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calculator, ListOrdered, ScrollText, Plus, Trash2 } from 'lucide-react'
import { ScoreCalculator } from '@/components/ScoreCalculator'
import { matchpoints, type PairResult } from '@/lib/bridge'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// 规则速查表数据

const TRICK_POINTS = [
  { strain: '♣ / ♦（低花）', per: '20 分 / 墩', note: '—' },
  { strain: '♥ / ♠（高花）', per: '30 分 / 墩', note: '—' },
  { strain: 'NT（无将）', per: '30 分 / 墩', note: '第一墩另加 10 分' },
]

const BONUSES = [
  { item: '部分定约（墩分 < 100）', nv: '50', v: '50' },
  { item: '成局奖分（墩分 ≥ 100）', nv: '300', v: '500' },
  { item: '小满贯（6 阶）', nv: '500', v: '750' },
  { item: '大满贯（7 阶）', nv: '1000', v: '1500' },
  { item: '完成加倍定约', nv: '50', v: '50' },
  { item: '完成再加倍定约', nv: '100', v: '100' },
  { item: '超墩（未加倍）', nv: '按墩分', v: '按墩分' },
  { item: '超墩（加倍）', nv: '100 / 墩', v: '200 / 墩' },
  { item: '超墩（再加倍）', nv: '200 / 墩', v: '400 / 墩' },
]

const PENALTIES = [
  { down: '宕 1', nvU: '50', vU: '100', nvX: '100', vX: '200' },
  { down: '宕 2', nvU: '100', vU: '200', nvX: '300', vX: '500' },
  { down: '宕 3', nvU: '150', vU: '300', nvX: '500', vX: '800' },
  { down: '宕 4', nvU: '200', vU: '400', nvX: '800', vX: '1100' },
  { down: '之后每墩', nvU: '+50', vU: '+100', nvX: '+300', vX: '+300' },
]

const COMMON_SCORES = [
  { label: '1NT 打成（无局）', score: 90 },
  { label: '2♠ 打成（无局）', score: 110 },
  { label: '3NT 打成（无局 / 有局）', score: '400 / 600' },
  { label: '4♥ 打成（无局 / 有局）', score: '420 / 620' },
  { label: '4♥ 超一（无局 / 有局）', score: '450 / 650' },
  { label: '6♠ 打成（无局 / 有局）', score: '980 / 1430' },
  { label: '5♣X 打成（有局）', score: 750 },
]

// ---------------------------------------------------------------------------
// MP 换算演示

function MpDemo() {
  const [rows, setRows] = useState<PairResult[]>([
    { pairId: '1', name: '1 号对', nsScore: 450 },
    { pairId: '2', name: '2 号对', nsScore: 420 },
    { pairId: '3', name: '3 号对', nsScore: 420 },
    { pairId: '4', name: '4 号对', nsScore: -50 },
    { pairId: '5', name: '5 号对', nsScore: -100 },
  ])

  const ranked = useMemo(() => matchpoints(rows, 'NS'), [rows])

  const update = (id: string, score: number) =>
    setRows((prev) => prev.map((r) => (r.pairId === id ? { ...r, nsScore: score } : r)))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListOrdered className="h-4 w-4 text-emerald-700" /> 比赛分换算演示（改分数，看 MP 变化）
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.pairId} className="flex items-center gap-2">
              <span className="w-14 text-sm text-muted-foreground">{r.name}</span>
              <Input
                type="number"
                value={r.nsScore}
                onChange={(e) => update(r.pairId, parseInt(e.target.value || '0'))}
                className="h-8 w-28"
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={rows.length <= 3}
                onClick={() => setRows((prev) => prev.filter((x) => x.pairId !== r.pairId))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((prev) => [...prev, { pairId: String(Date.now()), name: `${prev.length + 1} 号对`, nsScore: 0 }])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> 加一对
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">名次</TableHead>
              <TableHead>选手</TableHead>
              <TableHead className="text-right">南北分</TableHead>
              <TableHead className="text-right">MP</TableHead>
              <TableHead className="text-right">百分比</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((r) => (
              <TableRow key={r.pairId}>
                <TableCell>{r.rank}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className={cn('text-right tabular-nums', r.nsScore < 0 && 'text-rose-600')}>
                  {r.nsScore > 0 ? '+' : ''}{r.nsScore}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.mp} / {r.maxMp}</TableCell>
                <TableCell className="text-right tabular-nums">{r.pct.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------

export default function Scoring() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-800 text-amber-300">
          <ScrollText className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">双人赛记分规则</h1>
          <p className="text-sm text-muted-foreground">复式桥牌（Duplicate）定约计分 + 比赛分（Matchpoints）排名，与线下双人赛规则一致。</p>
        </div>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">规则详解</TabsTrigger>
          <TabsTrigger value="calculator">定约计分器</TabsTrigger>
          <TabsTrigger value="mp">MP 换算演示</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">一、双人赛基本流程</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm text-muted-foreground">
              <p>1. 同一副牌由全场多对选手分别打一遍（复式牌套传递，牌张不变）。</p>
              <p>2. 每副牌先按复式计分表算出<b className="text-foreground">定约方得分</b>（如 4♥ 打成无局 +420）。</p>
              <p>3. 把同一方向上（南北 / 东西）所有对的成绩两两比较：<b className="text-foreground">每胜过一对得 2 个比赛分（MP），平局各得 1 分，落败 0 分</b>。</p>
              <p>4. 全部牌副的 MP 累加，换算为<b className="text-foreground">百分比（MP ÷ 理论最高 MP）</b>，按百分比排定名次。</p>
              <p>5. 因此在双人赛中，超一墩（450 vs 420）常常比打成满贯更值钱——每一分的相对排名都重要。</p>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">二、墩分（每副前 6 墩为底墩，不计分）</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>将牌</TableHead><TableHead>每墩墩分</TableHead><TableHead>备注</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {TRICK_POINTS.map((r) => (
                      <TableRow key={r.strain}>
                        <TableCell className="font-medium">{r.strain}</TableCell>
                        <TableCell>{r.per}</TableCell>
                        <TableCell className="text-muted-foreground">{r.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">加倍后墩分 ×2，再加倍 ×4；墩分累计 ≥100 即构成局。</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">三、奖分表</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>项目</TableHead><TableHead className="text-right">无局</TableHead><TableHead className="text-right">有局</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {BONUSES.map((r) => (
                      <TableRow key={r.item}>
                        <TableCell>{r.item}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.nv}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.v}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">四、宕墩罚分（防守方得分，庄家方记负分）</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>宕墩数</TableHead>
                    <TableHead className="text-right">未加倍 · 无局</TableHead>
                    <TableHead className="text-right">未加倍 · 有局</TableHead>
                    <TableHead className="text-right">加倍 · 无局</TableHead>
                    <TableHead className="text-right">加倍 · 有局</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PENALTIES.map((r) => (
                    <TableRow key={r.down}>
                      <TableCell>{r.down}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.nvU}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.vU}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.nvX}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.vX}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">再加倍罚分为加倍的 2 倍。局况由副号决定：第 1 副双无、第 2 副南北有、第 3 副东西有、第 4 副双有，每 16 副循环。</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">五、常见得分速查</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {COMMON_SCORES.map((s) => (
                <Badge key={s.label} variant="secondary" className="px-3 py-1.5 text-xs">
                  {s.label}：<b className="ml-1 tabular-nums">{s.score}</b>
                </Badge>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calculator" className="mt-4">
          <div className="mx-auto max-w-2xl">
            <ScoreCalculator title="定约计分器 —— 输入定约与结果，立即得到复式分" />
          </div>
        </TabsContent>

        <TabsContent value="mp" className="mt-4">
          <MpDemo />
        </TabsContent>
      </Tabs>

      <div className="rounded-lg border border-emerald-900/10 bg-emerald-50 p-4 text-sm text-muted-foreground dark:bg-emerald-900/30">
        <Calculator className="mr-1 inline h-4 w-4" />
        提示：每日双人赛的成绩录入页内嵌了同款计分器，算完直接一键录入排行榜。
      </div>
    </div>
  )
}
