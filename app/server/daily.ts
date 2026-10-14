// 每日双人赛（服务端）：固定种子全场同牌 + 成绩持久化 + 跨玩家 MP 排行榜
// 牌局生成与模拟对手成绩均为纯函数（src/lib/data.ts），同一天所有玩家面对同样的牌与同样的对手
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchpoints, type Seat } from '../src/lib/bridge'
import { dealHands, type CardT } from '../src/lib/cards'
import { hashString, mulberry32, simulateBoardResults, todayEvent } from '../src/lib/data'
import type { DailyBoardStatus, DailyLeaderboardRow, DailyState } from '../src/lib/protocol'
import { recordEventResult } from './db'

const DATA_DIR = process.env.BRIDGEHUB_DATA ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const DAILY_FILE = join(DATA_DIR, 'daily.json')

interface DailyEntry {
  contract: string
  nsScore: number
  mp: number
  maxMp: number
}

interface DailyPlayerRecord {
  nickname: string
  entries: Record<string, DailyEntry> // key = 副号
  finishedAt?: string
  pct?: number
}

type DailyData = Record<string /* date */, Record<string /* userId */, DailyPlayerRecord>>

let data: DailyData = {}

function load() {
  try {
    data = JSON.parse(readFileSync(DAILY_FILE, 'utf-8'))
  } catch {
    data = {}
  }
}

let saveTimer: NodeJS.Timeout | null = null
function save() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = DAILY_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, DAILY_FILE)
  }, 200)
}

/** 某副牌的服务端固定发牌：同一天、同一副，全场所有玩家拿到完全相同的牌 */
export function dailyDeal(eventId: string, board: number): Record<Seat, CardT[]> {
  return dealHands(mulberry32(hashString(`${eventId}-deal-${board}`)))
}

/** 该玩家今天是否已打过某副（防刷分） */
export function hasPlayed(userId: string, board: number): boolean {
  const event = todayEvent()
  return !!data[event.date]?.[userId]?.entries[String(board)]
}

/**
 * 记录某副成绩；返回错误信息或 null。
 * 满 8 副时结算全场百分比并写入玩家战绩（参赛数 +1、最佳百分比）。
 */
export function recordDailyBoard(
  userId: string,
  nickname: string,
  board: number,
  contract: string,
  nsScore: number
): string | null {
  const event = todayEvent()
  if (board < 1 || board > event.boards.length) return '牌副不存在'
  const day = (data[event.date] ??= {})
  const rec = (day[userId] ??= { nickname, entries: {} })
  rec.nickname = nickname
  if (rec.entries[String(board)]) return '该副已提交过成绩'

  const field = [
    ...simulateBoardResults(event.id, board, null),
    { pairId: userId, name: nickname, board, contract, nsScore },
  ]
  const mine = matchpoints(field, 'NS').find((r) => r.pairId === userId)!
  rec.entries[String(board)] = { contract, nsScore, mp: mine.mp, maxMp: mine.maxMp }

  if (Object.keys(rec.entries).length >= event.boards.length && !rec.finishedAt) {
    const mp = Object.values(rec.entries).reduce((s, e) => s + e.mp, 0)
    const max = Object.values(rec.entries).reduce((s, e) => s + e.maxMp, 0)
    rec.pct = max > 0 ? (mp / max) * 100 : 0
    rec.finishedAt = new Date().toISOString()
    recordEventResult(userId, rec.pct)
  }
  save()
  return null
}

/** 组装某玩家视角的每日赛状态（牌副进度 + 全场排行榜 + 进行中名单） */
export function dailyState(userId: string): DailyState {
  const event = todayEvent()
  const day = data[event.date] ?? {}
  const mine = day[userId]

  const boards: DailyBoardStatus[] = event.boards.map((b) => {
    const e = mine?.entries[String(b.board)]
    return {
      board: b.board,
      dealer: b.dealer,
      vul: b.vul,
      hint: b.hint,
      played: !!e,
      contract: e?.contract,
      nsScore: e?.nsScore,
      mp: e?.mp,
      maxMp: e?.maxMp,
    }
  })

  // 排行榜：7 对模拟对手（视为已打满 8 副）+ 已完赛真人，逐副比赛分聚合
  const totals = new Map<string, { name: string; mp: number; max: number; human: boolean }>()
  const humans = Object.entries(day)
  for (const b of event.boards) {
    const results = simulateBoardResults(event.id, b.board, null).map((r) => ({ ...r }))
    for (const [uid, rec] of humans) {
      const e = rec.entries[String(b.board)]
      if (e) results.push({ pairId: uid, name: rec.nickname, board: b.board, contract: e.contract, nsScore: e.nsScore })
    }
    for (const r of matchpoints(results, 'NS')) {
      // 模拟对手的 pairId 每副不同（sim-<board>-<i>），用名字做稳定聚合键
      const key = r.pairId.startsWith('sim-') ? `sim:${r.name}` : r.pairId
      const cur = totals.get(key) ?? { name: r.name, mp: 0, max: 0, human: !r.pairId.startsWith('sim-') }
      cur.mp += r.mp
      cur.max += r.maxMp
      totals.set(key, cur)
    }
  }

  const leaderboard: DailyLeaderboardRow[] = []
  const live: { name: string; done: number; you?: boolean }[] = []
  for (const [key, v] of totals) {
    if (!v.human) {
      leaderboard.push({ pairId: key, name: v.name, mp: v.mp, maxMp: v.max, pct: v.max > 0 ? (v.mp / v.max) * 100 : 0, rank: 0 })
      continue
    }
    const rec = day[key]
    if (rec?.finishedAt) {
      leaderboard.push({ pairId: key, name: v.name, mp: v.mp, maxMp: v.max, pct: v.max > 0 ? (v.mp / v.max) * 100 : 0, rank: 0, you: key === userId || undefined })
    } else {
      live.push({ name: v.name, done: Object.keys(rec?.entries ?? {}).length, you: key === userId || undefined })
    }
  }
  leaderboard.sort((a, b) => b.mp - a.mp)
  leaderboard.forEach((r, i) => (r.rank = i + 1))
  live.sort((a, b) => b.done - a.done)

  return {
    eventId: event.id,
    date: event.date,
    title: event.title,
    system: event.system,
    fieldSize: event.fieldSize,
    boards,
    myDone: boards.filter((b) => b.played).length,
    myPct: mine?.finishedAt ? mine.pct ?? null : null,
    leaderboard,
    live,
  }
}

load()
