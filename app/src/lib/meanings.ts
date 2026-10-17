// 叫品含义速查：根据叫牌体系与叫牌上下文，给出某个叫品的参考含义
// 与「叫牌体系」页的体系卡（data.ts NATURAL_SYSTEM / PRECISION_SYSTEM）保持一致
import { STRAIN_LABEL, type Strain } from './bridge'
import { partnerOf, type AuctionEntry } from './game'
import type { BiddingSystem } from './data'

export interface CallMeaning {
  title: string // 叫品文本，如 1♣
  role: string // 开叫 / 应叫 / 再叫·竞叫
  lines: string[] // 含义要点
}

const STRAIN_CN: Record<Strain, string> = { C: '梅花', D: '方块', H: '红心', S: '黑桃', NT: '无将' }

function openingMeaning(level: number, strain: Strain, system: BiddingSystem): string[] {
  if (system === 'precision') {
    if (level === 1 && strain === 'C') return ['任意强牌（人为约定叫，精确制核心叫品）', '16 点以上，逼叫']
    if (level === 1 && strain === 'D') return ['非强牌，均型或低花', '11–15 点，2 张以上，不保证实套']
    if (level === 1 && (strain === 'H' || strain === 'S')) return [`${STRAIN_CN[strain]}开叫`, '11–15 点，5 张以上（限定性五张高花）']
    if (level === 1 && strain === 'NT') return ['均型开叫', '13–15 点（比自然制弱无将更轻）']
    if (level === 2 && strain === 'C') return ['梅花套开叫', '11–15 点，6 张以上梅花（或 5 张梅花 + 4 张高花）']
    if (level === 2 && strain === 'D') return ['三套牌（短方块）', '11–15 点，4-4-1-4 / 4-3-1-5 等牌型']
    if (level === 2 && (strain === 'H' || strain === 'S')) return ['弱二开叫', '6–10 点，6 张套，阻击性']
    if (level === 2 && strain === 'NT') return ['均型强牌', '16–18 点以上']
    return ['阻击叫', '弱牌长套（通常 7 张以上），压缩对方叫牌空间']
  }
  // 自然制
  if (level === 1 && (strain === 'C' || strain === 'D')) return [`${STRAIN_CN[strain]}开叫`, '12–21 点，3 张以上；无 5 张高花时开叫较长低花']
  if (level === 1 && (strain === 'H' || strain === 'S')) return [`${STRAIN_CN[strain]}开叫`, '12–21 点，5 张以上（五张高花体系）']
  if (level === 1 && strain === 'NT') return ['均型开叫', '15–17 点']
  if (level === 2 && strain === 'C') return ['强牌逼叫（人为约定叫）', '22 点以上，逼叫一轮']
  if (level === 2 && strain === 'NT') return ['均型强牌', '20–21 点']
  if (level === 2) return ['弱二开叫', '6–10 点，6 张套，阻击性']
  return ['阻击叫', '弱牌长套（通常 7 张以上），压缩对方叫牌空间']
}

function responseMeaning(
  level: number,
  strain: Strain,
  opening: { level: number; strain: Strain },
  system: BiddingSystem
): string[] {
  const o = opening
  // 精确制：对 1♣ 强开叫
  if (system === 'precision' && o.level === 1 && o.strain === 'C') {
    if (level === 1 && strain === 'D') return ['示弱应叫（人为约定叫）', '0–7 点，不保证方块实套']
    if (strain !== 'NT' && ((level === 1 && (strain === 'H' || strain === 'S')) || (level === 2 && (strain === 'C' || strain === 'D'))))
      return ['实套积极应叫', '8 点以上，5 张以上，逼叫成局']
    if (level === 1 && strain === 'NT') return ['均型应叫', '8–13 点，无 5 张套']
    if (strain === 'NT') return ['均型强牌', '14 点以上']
    return ['坚强套跳叫', '8 点以上，邀请满贯']
  }
  // 对 1NT 开叫
  if (o.level === 1 && o.strain === 'NT') {
    if (level === 2 && strain === 'C') return ['斯台曼问叫（人为约定叫）', '8 点以上，问开叫方有无 4 张高花']
    if (level === 2 && (strain === 'D' || strain === 'H')) return ['转移叫（人为约定叫）', `要求同伴改叫 ${strain === 'D' ? '红心' : '黑桃'}`]
    if (level === 2 && strain === 'NT') return ['均型邀局', '8–9 点']
    if (level === 3 && strain === 'NT') return ['均型封局', '10 点以上']
    if (level >= 4 && (strain === 'H' || strain === 'S')) return ['高花封局', '6 张以上实套']
    return ['应叫', '按体系约定描述牌力与牌型']
  }
  // 自然制：对 2♣ 强开叫
  if (system === 'natural' && o.level === 2 && o.strain === 'C') {
    if (level === 2 && strain === 'D') return ['过渡应叫（人为约定叫）', '不保证方块，等待开叫方进一步描述']
    return ['积极应叫', '8 点以上，实套']
  }
  // 对弱二开叫
  if (o.level === 2 && o.strain !== 'NT' && o.strain !== 'C') {
    if (strain === o.strain && level >= 4) return ['加叫封局', '强支持，直接成局']
    if (strain === o.strain) return ['加叫阻击', '配合同伴，进一步压缩空间']
    return ['应叫', '对弱二开叫的回应']
  }
  // 对一阶花色开叫
  if (o.level === 1 && o.strain !== 'NT') {
    if (strain === o.strain) {
      if (level === 2) return ['简单加叫', '6–10 点，3 张以上支持']
      if (level === 3) return ['跳加叫', '11–12 点，4 张支持，邀局']
      return ['加叫封局', '13 点以上，配合良好']
    }
    if (strain === 'NT') {
      if (level === 1) return ['无将应叫', '6–10 点，均型，无配合']
      if (level === 2) return ['均型邀局', '11–12 点']
      return ['无将应叫', '均型强牌']
    }
    if (level === 1) return ['一阶新花应叫', system === 'precision' ? '8 点以上，4 张以上，逼叫一轮' : '6 点以上，4 张以上（一盖一）']
    if (level === 2) return ['二盖一新花', '11 点以上，5 张以上，逼叫一轮']
    return ['跳叫新花', '强牌实套或阻击，视进程而定']
  }
  return ['应叫', '按体系约定描述牌力与牌型']
}

/** 给出某个叫品在其上下文中的参考含义 */
export function callMeaning(auction: AuctionEntry[], idx: number, system: BiddingSystem): CallMeaning {
  const entry = auction[idx]
  const call = entry.call
  const seat = entry.seat

  if (call.type === 'pass') return { title: 'Pass', role: '', lines: ['不叫：本轮不做出实质叫品'] }
  if (call.type === 'X') return { title: '加倍 X', role: '', lines: ['提高该定约的得分与宕墩罚分', '低阶时也可用作技术性加倍（约定）'] }
  if (call.type === 'XX') return { title: '再加倍 XX', role: '', lines: ['进一步提高本定约的得失分'] }

  const before = auction.slice(0, idx)
  const anyBidBefore = before.some((a) => a.call.type === 'bid')
  const partner = partnerOf(seat)
  const partnerBids = before.filter((a) => a.seat === partner && a.call.type === 'bid')
  const myBidsBefore = before.filter((a) => a.seat === seat && a.call.type === 'bid')
  const text = `${call.level}${STRAIN_LABEL[call.strain]}`

  if (!anyBidBefore) {
    return { title: text, role: '开叫', lines: openingMeaning(call.level, call.strain, system) }
  }
  if (myBidsBefore.length === 0 && partnerBids.length > 0) {
    const o = partnerBids[0].call as { type: 'bid'; level: number; strain: Strain }
    return { title: text, role: '应叫', lines: responseMeaning(call.level, call.strain, o, system) }
  }
  // 再叫 / 竞叫
  const lines: string[] = []
  const myLast = myBidsBefore[myBidsBefore.length - 1]?.call as { level: number; strain: Strain } | undefined
  const partnerLast = partnerBids[partnerBids.length - 1]?.call as { level: number; strain: Strain } | undefined
  if (myLast && call.strain === myLast.strain) lines.push(`再叫${STRAIN_CN[call.strain]}：显示额外长度或强度`)
  else if (partnerLast && call.strain === partnerLast.strain) lines.push(`加叫同伴的${STRAIN_CN[call.strain]}：显示配合与支持`)
  else if (call.strain === 'NT') lines.push('无将：均型，通常在未叫花色有止张')
  else lines.push(`${STRAIN_CN[call.strain]}实套：新花描述或竞叫`)
  const game =
    (call.strain === 'NT' && call.level >= 3) ||
    ((call.strain === 'H' || call.strain === 'S') && call.level >= 4) ||
    call.level >= 5
  if (call.level >= 6) lines.push('满贯叫品：尝试满贯得分')
  else if (game) lines.push('成局叫品：目标是成局奖分')
  return { title: text, role: myBidsBefore.length > 0 ? '再叫' : '竞叫', lines }
}
