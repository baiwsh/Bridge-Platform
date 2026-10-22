// 服务端安全加固中间件：请求体限制、安全响应头、基于 IP 的滑动窗口限流、WS 连接限流
// 说明：全部内联实现，不引入额外依赖。生产环境若有 Redis/反向代理，可替换为分布式限流。
import type { NextFunction, Request, Response } from 'express'

// ---------- 请求体大小限制 ----------

/** JSON 请求体上限（账号接口只需极小载荷） */
export const JSON_LIMIT = process.env.JSON_LIMIT ?? '32kb'

// ---------- 安全响应头 ----------

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // 禁止被嵌入 iframe（防点击劫持）
  res.setHeader('X-Frame-Options', 'DENY')
  // 关闭 MIME 嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // 基础 CSP：仅允许同源资源；WebSocket 需放宽 connect-src（同源 wss 已被 'self' 覆盖）
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  )
  // 不发送 Referer 给第三方
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // 限制浏览器特性
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  // 跨资源隔离（Spectre 缓解）
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  // HSTS：仅在确认走 HTTPS（含反向代理）时启用
  if (process.env.BEHIND_HTTPS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  // 隐藏技术栈指纹
  res.removeHeader('X-Powered-By')
  next()
}

// ---------- 滑动窗口限流 ----------

interface Window {
  hits: number[]
  /** 超限后进入惩罚期（指数退避），到期自动解除 */
  blockedUntil: number
}

const buckets = new Map<string, Window>()

/**
 * 客户端 IP：仅在 TRUST_PROXY=1 时采纳反向代理透传的头。
 *
 * 取值顺序很重要，取错会让限流形同虚设：
 * 1) X-Real-IP —— Nginx 侧 `proxy_set_header X-Real-IP $remote_addr` 是无条件覆写，
 *    客户端自带值会被替换掉，因此这个值不可伪造，最可信。
 * 2) X-Forwarded-For —— Nginx 的 `$proxy_add_x_forwarded_for` 是「追加」语义，
 *    链路形如 `<客户端伪造的任意值>, <真实客户端IP>`。**必须取右侧**，
 *    取左侧的话攻击者换一个 XFF 就能拿到全新配额，直接绕过限流。
 * 3) 都不存在（直连场景）时回落到 socket 地址。
 *
 * 注意：只有在确认应用「仅通过会覆写上述头的反向代理对外暴露」时才设置 TRUST_PROXY=1。
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    // 1) X-Real-IP：由代理覆写，优先使用
    const real = req.headers['x-real-ip']
    if (typeof real === 'string' && real.trim().length > 0) {
      return real.split(',')[0]!.trim()
    }
    // 2) XFF：从右往左数 TRUST_PROXY_HOPS 段，跳过客户端伪造部分
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string' && fwd.trim().length > 0) {
      const parts = fwd
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      if (parts.length > 0) {
        const hops = Math.max(1, parseInt(process.env.TRUST_PROXY_HOPS ?? '1') || 1)
        return parts[Math.max(0, parts.length - hops)]!
      }
    }
  }
  return req.ip || req.socket.remoteAddress || 'unknown'
}

interface RateLimitOptions {
  /** 时间窗内的最大请求数 */
  max: number
  /** 时间窗长度（毫秒） */
  windowMs: number
  /** 超限时返回的错误文案 */
  message: string
}

/**
 * 按 IP 限流。超过阈值后进入指数退避惩罚期，防止持续爆破。
 * 内存字典会周期性清理过期记录，避免长时间运行导致内存膨胀。
 */
export function rateLimit(opts: RateLimitOptions) {
  let lastGc = Date.now()
  const { max, windowMs, message } = opts

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now()

    // 每 10 分钟做一次过期清理
    if (now - lastGc > 10 * 60 * 1000) {
      for (const [k, w] of buckets) {
        if (w.blockedUntil < now && w.hits.every((t) => now - t > windowMs)) buckets.delete(k)
      }
      lastGc = now
    }

    const key = clientIp(req)
    const w = buckets.get(key) ?? { hits: [], blockedUntil: 0 }

    // 仍在惩罚期内
    if (w.blockedUntil > now) {
      buckets.set(key, w)
      const retrySec = Math.ceil((w.blockedUntil - now) / 1000)
      res.setHeader('Retry-After', String(retrySec))
      res.status(429).json({ error: `${message}，请 ${retrySec} 秒后重试` })
      return
    }

    // 只保留时间窗内的记录
    w.hits = w.hits.filter((t) => now - t < windowMs)

    if (w.hits.length >= max) {
      // 触发惩罚：起步 30 秒，按超出倍数增大，最长 30 分钟
      const overshoot = w.hits.length - max + 1
      const penalty = Math.min(30 * 1000 * Math.min(overshoot, 60), 30 * 60 * 1000)
      w.blockedUntil = now + penalty
      w.hits = []
      buckets.set(key, w)
      const retrySec = Math.ceil(penalty / 1000)
      res.setHeader('Retry-After', String(retrySec))
      res.status(429).json({ error: `${message}，请 ${retrySec} 秒后重试` })
      return
    }

    w.hits.push(now)
    buckets.set(key, w)
    // 告知剩余配额，便于客户端退避
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - w.hits.length)))
    next()
  }
}

/** 认证类接口：5 分钟窗口内允许 20 次（正常登录远低于此，足以拦截撞库） */
export const authLimiter = rateLimit({
  max: parseInt(process.env.AUTH_RATE_MAX ?? '20'),
  windowMs: parseInt(process.env.AUTH_RATE_WINDOW_MS ?? String(5 * 60 * 1000)),
  message: '操作过于频繁',
})

/** 通用 API：1 分钟窗口内允许 120 次 */
export const apiLimiter = rateLimit({
  max: parseInt(process.env.API_RATE_MAX ?? '120'),
  windowMs: parseInt(process.env.API_RATE_WINDOW_MS ?? '60000'),
  message: '请求过于频繁',
})

// ---------- WebSocket 连接限流 ----------

const wsWindows = new Map<string, { conns: number[]; failed: number[] }>()

/**
 * WebSocket 接入限流：
 * - 新连接：同一 IP 每分钟最多 30 次
 * - 认证失败：同一 IP 每分钟最多 10 次，超出后短期拒绝
 * 防止攻击者用大量 WS 连接耗尽服务端资源或反复试探 token。
 */
export function wsAllowed(ip: string, isFailure: boolean): boolean {
  const now = Date.now()
  const winMs = 60 * 1000
  const w = wsWindows.get(ip) ?? { conns: [], failed: [] }
  w.conns = w.conns.filter((t) => now - t < winMs)
  w.failed = w.failed.filter((t) => now - t < winMs)

  if (isFailure) {
    if (w.failed.length >= 10) {
      wsWindows.set(ip, w)
      return false
    }
    w.failed.push(now)
    wsWindows.set(ip, w)
    return true
  }

  if (w.conns.length >= 30) {
    wsWindows.set(ip, w)
    return false
  }
  w.conns.push(now)
  wsWindows.set(ip, w)
  return true
}
