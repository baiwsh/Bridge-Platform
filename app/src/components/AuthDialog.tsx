import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useStore } from '@/lib/store'

export function AuthDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { login, register, online } = useStore()
  const [error, setError] = useState<string | null>(null)

  const [loginName, setLoginName] = useState('')
  const [loginPw, setLoginPw] = useState('')

  const [regName, setRegName] = useState('')
  const [regNick, setRegNick] = useState('')
  const [regPw, setRegPw] = useState('')
  const [regPw2, setRegPw2] = useState('')

  const doLogin = async () => {
    const err = await login(loginName, loginPw)
    if (err) setError(err)
    else {
      setError(null)
      onOpenChange(false)
    }
  }

  const doRegister = async () => {
    if (regPw !== regPw2) {
      setError('两次输入的密码不一致')
      return
    }
    const err = await register(regName, regNick, regPw)
    if (err) setError(err)
    else {
      setError(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>欢迎来到桥牌汇</DialogTitle>
          <DialogDescription>注册玩家账号后即可创建牌桌、参加每日双人赛并记录战绩。</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="login" onValueChange={() => setError(null)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">登录</TabsTrigger>
            <TabsTrigger value="register">注册新账号</TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="l-name">用户名</Label>
              <Input id="l-name" value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="your_name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-pw">密码</Label>
              <Input id="l-pw" type="password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button className="w-full bg-emerald-700 hover:bg-emerald-600" onClick={doLogin}>
              登录
            </Button>
          </TabsContent>

          <TabsContent value="register" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-name">用户名（登录用）</Label>
              <Input id="r-name" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="3–16 位字母、数字或下划线" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-nick">昵称（牌桌显示名）</Label>
              <Input id="r-nick" value={regNick} onChange={(e) => setRegNick(e.target.value)} placeholder="例如：虹口小将" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="r-pw">密码</Label>
                <Input id="r-pw" type="password" value={regPw} onChange={(e) => setRegPw(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-pw2">确认密码</Label>
                <Input id="r-pw2" type="password" value={regPw2} onChange={(e) => setRegPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doRegister()} />
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button className="w-full bg-emerald-700 hover:bg-emerald-600" onClick={doRegister}>
              创建账号并登录
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {online ? '账号数据保存在平台服务器，可在任意设备登录。' : '离线模式：账号数据仅保存在本机浏览器中。'}
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
