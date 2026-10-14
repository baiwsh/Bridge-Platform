import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { NATURAL_SYSTEM, PRECISION_SYSTEM, type SystemSection } from '@/lib/data'
import { BookOpen, Scale, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

function coloredBid(bid: string) {
  // 将叫品中的 ♥♦ 染红
  return bid.split(/([♥♦])/).map((part, i) =>
    part === '♥' || part === '♦' ? (
      <span key={i} className="text-rose-500">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

function SystemCard({ sections, accent }: { sections: SystemSection[]; accent: string }) {
  return (
    <div className="space-y-4">
      {sections.map((sec) => (
        <Card key={sec.title}>
          <CardHeader className="pb-2">
            <CardTitle className={cn('text-base', accent)}>{sec.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">叫品</TableHead>
                  <TableHead className="w-28">点力</TableHead>
                  <TableHead className="w-40">含义</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sec.rows.map((r) => (
                  <TableRow key={r.bid}>
                    <TableCell className="font-mono font-medium">{coloredBid(r.bid)}</TableCell>
                    <TableCell>{r.points ?? '—'}</TableCell>
                    <TableCell>{r.meaning}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function Systems() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-800 text-amber-300">
          <BookOpen className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">叫牌体系</h1>
          <p className="text-sm text-muted-foreground">平台牌桌支持两种体系：自然制与精确制。创建牌桌时选择，以下为完整约定卡。</p>
        </div>
      </div>

      {/* 体系对比 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-emerald-900/10">
          <CardContent className="flex gap-3 p-4">
            <Scale className="h-8 w-8 shrink-0 text-emerald-700" />
            <div className="text-sm">
              <div className="mb-1 flex items-center gap-2 font-semibold">自然制 <Badge variant="outline" className="text-xs">标准美式 / 二盖一</Badge></div>
              <p className="text-muted-foreground">以自然实套叫牌为核心：五张高花开叫、强无将 15–17、2♣ 人为强叫。结构直观，适合从入门到进阶。</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-900/10">
          <CardContent className="flex gap-3 p-4">
            <Target className="h-8 w-8 shrink-0 text-rose-600" />
            <div className="text-sm">
              <div className="mb-1 flex items-center gap-2 font-semibold">精确制 <Badge variant="outline" className="text-xs">Precision Club</Badge></div>
              <p className="text-muted-foreground">1♣ 人为强开叫（16+），其余开叫均为限定叫（11–15）。点力范围窄、信息传递精确，满贯叫牌优势明显。</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="natural">
        <TabsList className="grid w-full grid-cols-2 sm:w-64">
          <TabsTrigger value="natural">自然制体系卡</TabsTrigger>
          <TabsTrigger value="precision">精确制体系卡</TabsTrigger>
        </TabsList>
        <TabsContent value="natural" className="mt-4">
          <SystemCard sections={NATURAL_SYSTEM} accent="text-emerald-700" />
        </TabsContent>
        <TabsContent value="precision" className="mt-4">
          <SystemCard sections={PRECISION_SYSTEM} accent="text-rose-600" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
