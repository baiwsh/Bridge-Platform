// 每日双人赛入口：在线登录 → 服务端联机版；离线 → 本地录入版
import { useStore } from '@/lib/store'
import DailyEventLocal from './DailyEventLocal'
import DailyEventOnline from './DailyEventOnline'

export default function DailyEvent() {
  const { online, user } = useStore()
  if (online && user) return <DailyEventOnline />
  return <DailyEventLocal />
}
