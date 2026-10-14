import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useState } from 'react'
import { Spade, Heart, Club, Diamond, LogOut, User as UserIcon, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AuthDialog } from './AuthDialog'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function SuitGlyph({ s, className }: { s: 'S' | 'H' | 'D' | 'C'; className?: string }) {
  const map = { S: Spade, H: Heart, D: Diamond, C: Club } as const
  const Icon = map[s]
  const color = s === 'H' || s === 'D' ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'
  return <Icon className={cn('inline-block fill-current', color, className)} />
}

const NAV = [
  { to: '/', label: '首页' },
  { to: '/lobby', label: '活动大厅' },
  { to: '/event/daily', label: '每日双人赛' },
  { to: '/scoring', label: '记分规则' },
  { to: '/systems', label: '叫牌体系' },
]

export function NavBar() {
  const { user, logout } = useStore()
  const [authOpen, setAuthOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-900/40 bg-emerald-950/95 text-emerald-50 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-wide">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400 text-emerald-950">
            <Spade className="h-4 w-4 fill-current" />
          </span>
          <span className="text-lg">桥牌汇</span>
          <span className="hidden text-xs font-normal text-emerald-300/70 sm:inline">BridgeHub</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive ? 'bg-emerald-800 text-amber-300' : 'text-emerald-100/80 hover:bg-emerald-900 hover:text-emerald-50'
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-emerald-900">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback style={{ backgroundColor: user.color }} className="text-white">
                      {user.nickname.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm sm:inline">{user.nickname}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="text-sm">{user.nickname}</div>
                  <div className="text-xs text-muted-foreground">等级分 {user.rating} · 已赛 {user.gamesPlayed} 场</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <UserIcon className="mr-2 h-4 w-4" /> 个人中心
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" /> 退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" className="bg-amber-400 text-emerald-950 hover:bg-amber-300" onClick={() => setAuthOpen(true)}>
              登录 / 注册
            </Button>
          )}
          <button className="md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="菜单">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-emerald-900 px-4 py-2 md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={() => setMenuOpen(false)}
              className="block rounded-md px-3 py-2 text-sm text-emerald-100/90 hover:bg-emerald-900"
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </header>
  )
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-emerald-50/60 dark:bg-emerald-950">
      <NavBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
        <Outlet />
      </main>
      <footer className="border-t bg-emerald-950 py-6 text-center text-xs text-emerald-300/60">
        桥牌汇 BridgeHub · 在线桥牌活动平台 · 支持精确制 / 自然制 · 双人赛 MP 计分
      </footer>
    </div>
  )
}
