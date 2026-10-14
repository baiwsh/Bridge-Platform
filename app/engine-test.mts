// 引擎回测：全 AI 自动完成整副牌，校验规则守恒
import { dealHands } from './src/lib/cards.ts'
import { chooseBid, choosePlay, auctionOver, getContract, callRules, nextSeat, legalPlays, trickWinner } from './src/lib/game.ts'
import { boardDealer, boardVul, contractScore, seatPartnership } from './src/lib/bridge.ts'

const systems = ['natural', 'precision']
let stats = { boards: 0, passouts: 0, games: 0, slams: 0, partials: 0, auctions: 0 }
let errors = []

for (const system of systems) {
  for (let board = 1; board <= 120; board++) {
    const hands = dealHands()
    const dealer = boardDealer(board)
    const vul = boardVul(board)

    // ---- 叫牌 ----
    const auction = []
    let turn = dealer
    let guard = 0
    while (!auctionOver(auction)) {
      if (++guard > 120) { errors.push(`${system} board${board}: 叫牌超过 120 手`); break }
      const call = chooseBid(hands[turn], auction, turn, system)
      // 校验叫品合法
      const rules = callRules(auction, turn)
      if (call.type === 'bid' && rules.minBidRank > 0) {
        const r = call.level * 5 + ['C','D','H','S','NT'].indexOf(call.strain)
        if (r < rules.minBidRank) errors.push(`${system} board${board}: 非法低叫 ${call.level}${call.strain} (minRank=${rules.minBidRank})`)
        if (call.level < 1 || call.level > 7) errors.push(`${system} board${board}: 非法阶数`)
      }
      if (call.type === 'X' && !rules.canX) errors.push(`${system} board${board}: 非法加倍`)
      if (call.type === 'XX' && !rules.canXX) errors.push(`${system} board${board}: 非法再加倍`)
      auction.push({ seat: turn, call })
      turn = nextSeat(turn)
    }
    stats.auctions += auction.length

    const contract = getContract(auction)
    if (!contract) { stats.passouts++; continue }
    stats.boards++
    if ((contract.strain === 'NT' && contract.level >= 3) || (['H','S'].includes(contract.strain) && contract.level >= 4) || contract.level >= 5) stats.games++
    if (contract.level >= 6) stats.slams++
    if (contract.level <= 2 || (contract.level === 3 && contract.strain !== 'NT') || (contract.level === 4 && ['C','D'].includes(contract.strain))) stats.partials++

    // ---- 打牌 ----
    const trump = contract.strain === 'NT' ? null : contract.strain
    const playHands = { N: [...hands.N], E: [...hands.E], S: [...hands.S], W: [...hands.W] }
    let leader = nextSeat(contract.declarer)
    let trick = []
    let tricksNS = 0, tricksEW = 0
    let played = 0
    let seen = new Set()
    while (played < 52) {
      const legal = legalPlays(playHands[turn], trick)
      const card = choosePlay(playHands[turn], trick, trump, turn)
      if (!legal.some((c) => c.suit === card.suit && c.rank === card.rank)) {
        errors.push(`${system} board${board}: ${turn} 打出非法牌 ${card.suit}${card.rank}（应跟 ${trick[0]?.card.suit ?? '任意'}）`)
        break
      }
      const id = card.suit + card.rank
      if (seen.has(id)) { errors.push(`${system} board${board}: 牌 ${id} 被打出两次`); break }
      seen.add(id)
      playHands[turn] = playHands[turn].filter((c) => !(c.suit === card.suit && c.rank === card.rank))
      trick.push({ seat: turn, card })
      played++
      if (trick.length === 4) {
        const w = trickWinner(trick, trump)
        if (seatPartnership(w) === 'NS') tricksNS++; else tricksEW++
        turn = w
        trick = []
      } else {
        turn = nextSeat(turn)
      }
    }
    if (tricksNS + tricksEW !== 13) errors.push(`${system} board${board}: 墩数 ${tricksNS}+${tricksEW} ≠ 13`)

    // ---- 记分 ----
    const decTricks = seatPartnership(contract.declarer) === 'NS' ? tricksNS : tricksEW
    const s = contractScore({ ...contract, tricks: decTricks, vul })
    if (s.made && s.score <= 0) errors.push(`${system} board${board}: 打成但得分非正`)
    if (!s.made && s.score >= 0) errors.push(`${system} board${board}: 宕墩但得分非负`)
  }
}

console.log('回测完成:', JSON.stringify(stats))
console.log('平均拍卖长度:', (stats.auctions / 240).toFixed(1))
if (errors.length) {
  console.log(`\n发现 ${errors.length} 个问题（前 10 条）:`)
  errors.slice(0, 10).forEach((e) => console.log(' -', e))
  process.exit(1)
} else {
  console.log('守恒与合法性全部通过 ✔')
}
