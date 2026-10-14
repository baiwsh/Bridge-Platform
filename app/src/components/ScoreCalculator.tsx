import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'
import {
  contractScore,
  describeContract,
  type ContractInput,
  type Doubled,
  type Seat,
  type Strain,
  type Vul,
  STRAIN_LABEL,
  STRAIN_NAME,
} from '@/lib/bridge'
import { cn } from '@/lib/utils'

export interface ScoreCalcValue extends ContractInput {
  score: number
  made: boolean
}

const SEATS: Seat[] = ['N', 'E', 'S', 'W']
const SEAT_NAME: Record<Seat, string> = { N: '北', E: '东', S: '南', W: '西' }

export function ScoreCalculator({
  title = '定约计分器',
  defaultVul = 'none',
  onScore,
}: {
  title?: string
  defaultVul?: Vul
  /** 每次计算出有效分数时回调（用于赛事录入） */
  onScore?: (v: ScoreCalcValue) => void
}) {
  const [level, setLevel] = useState('3')
  const [strain, setStrain] = useState<Strain>('NT')
  const [doubled, setDoubled] = useState<Doubled>('none')
  const [declarer, setDeclarer] = useState<Seat>('S')
  const [result, setResult] = useState('=') // '=' 或 '+1..+7' / '-1..-13'（相对墩差）
  const [vul, setVul] = useState<Vul>(defaultVul)

  const computed = useMemo(() => {
    const lv = parseInt(level)
    const diff = result === '=' ? 0 : parseInt(result)
    const tricks = 6 + lv + diff
    if (tricks < 0 || tricks > 13) return null
    const input: ContractInput = { level: lv, strain, doubled, declarer, tricks, vul }
    const r = contractScore(input)
    return { input, r }
  }, [level, strain, doubled, declarer, result, vul])

  useEffect(() => {
    if (computed && onScore) onScore({ ...computed.input, score: computed.r.score, made: computed.r.made })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>定约阶数</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7].map((l) => (
                  <SelectItem key={l} value={String(l)}>{l} 阶</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>将牌花色</Label>
            <Select value={strain} onValueChange={(v) => setStrain(v as Strain)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(STRAIN_LABEL) as Strain[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className={cn(s === 'H' || s === 'D' ? 'text-rose-500' : '')}>
                      {STRAIN_LABEL[s]} {STRAIN_NAME[s]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>加倍状态</Label>
            <ToggleGroup type="single" value={doubled} onValueChange={(v) => v && setDoubled(v as Doubled)} className="justify-start">
              <ToggleGroupItem value="none">无</ToggleGroupItem>
              <ToggleGroupItem value="X">X</ToggleGroupItem>
              <ToggleGroupItem value="XX">XX</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <Label>庄家</Label>
            <ToggleGroup type="single" value={declarer} onValueChange={(v) => v && setDeclarer(v as Seat)} className="justify-start">
              {SEATS.map((s) => (
                <ToggleGroupItem key={s} value={s}>{SEAT_NAME[s]}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <Label>结果（墩差）</Label>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="=">正好打成 =</SelectItem>
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <SelectItem key={`+${d}`} value={`+${d}`}>超 {d} 墩</SelectItem>
                ))}
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
                  <SelectItem key={`-${d}`} value={`-${d}`}>宕 {d} 墩</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>局况</Label>
            <Select value={vul} onValueChange={(v) => setVul(v as Vul)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">双无局</SelectItem>
                <SelectItem value="NS">南北有局</SelectItem>
                <SelectItem value="EW">东西有局</SelectItem>
                <SelectItem value="both">双有局</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {computed && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold">{describeContract(computed.input)}</span>
              <Badge variant={computed.r.made ? 'default' : 'destructive'} className={computed.r.made ? 'bg-emerald-600' : ''}>
                {computed.r.made ? '打成' : `宕 ${computed.r.undertricks}`}
              </Badge>
              <span className={cn('ml-auto text-2xl font-bold tabular-nums', computed.r.score >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {computed.r.score > 0 ? `+${computed.r.score}` : computed.r.score}
              </span>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {computed.r.breakdown.map((b, i) => (
                <li key={i}>· {b}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
