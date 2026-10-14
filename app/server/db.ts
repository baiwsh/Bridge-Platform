// 账号与令牌存储：scrypt 密码散列 + JSON 文件持久化
// 说明：演示级实现。生产环境建议换 SQLite/PostgreSQL，并加限流、邮箱验证等。
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = process.env.BRIDGEHUB_DATA ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const DB_FILE = join(DATA_DIR, 'users.json')

export interface ServerUser {
  id: string
  username: string
  nickname: string
  color: string
  passwordHash: string // scrypt:salt:hash
  createdAt: string
  rating: number
  gamesPlayed: number
  bestPct: number
}

interface Session {
  token: string
  userId: string
  expiresAt: number
}

interface Db {
  users: ServerUser[]
  sessions: Session[]
}

const AVATAR_COLORS = ['#e11d48', '#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#f97316', '#d946ef', '#22d3ee']

let db: Db = { users: [], sessions: [] }

function load() {
  try {
    db = JSON.parse(readFileSync(DB_FILE, 'utf-8'))
  } catch {
    db = { users: [], sessions: [] }
  }
}

let saveTimer: NodeJS.Timeout | null = null
function save() {
  // 简单防抖写盘
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = DB_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(db, null, 1))
    renameSync(tmp, DB_FILE)
  }, 200)
}

function hashPassword(pw: string, salt?: string): string {
  const s = salt ?? randomBytes(16).toString('hex')
  const h = scryptSync(pw, s, 32).toString('hex')
  return `scrypt:${s}:${h}`
}

function verifyPassword(pw: string, stored: string): boolean {
  const [algo, salt, h] = stored.split(':')
  if (algo !== 'scrypt' || !salt || !h) return false
  const test = scryptSync(pw, salt, 32)
  const ref = Buffer.from(h, 'hex')
  return test.length === ref.length && timingSafeEqual(test, ref)
}

export function publicUser(u: ServerUser) {
  const { passwordHash, ...rest } = u
  return rest
}

export function registerUser(username: string, nickname: string, password: string): { user?: ServerUser; error?: string } {
  const name = username.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,16}$/.test(name)) return { error: '用户名需为 3–16 位字母、数字或下划线' }
  if (password.length < 6) return { error: '密码至少 6 位' }
  if (db.users.some((u) => u.username === name)) return { error: '该用户名已被注册' }
  const user: ServerUser = {
    id: 'u-' + randomBytes(6).toString('hex'),
    username: name,
    nickname: nickname.trim() || name,
    color: AVATAR_COLORS[db.users.length % AVATAR_COLORS.length],
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    rating: 1200,
    gamesPlayed: 0,
    bestPct: 0,
  }
  db.users.push(user)
  save()
  return { user }
}

export function loginUser(username: string, password: string): { user?: ServerUser; error?: string } {
  const u = db.users.find((x) => x.username === username.trim().toLowerCase())
  if (!u) return { error: '账号不存在，请先注册' }
  if (!verifyPassword(password, u.passwordHash)) return { error: '密码不正确' }
  return { user: u }
}

export function createSession(userId: string): string {
  const token = randomBytes(24).toString('hex')
  db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now())
  db.sessions.push({ token, userId, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 })
  save()
  return token
}

export function userByToken(token: string | undefined): ServerUser | null {
  if (!token) return null
  const s = db.sessions.find((x) => x.token === token && x.expiresAt > Date.now())
  if (!s) return null
  return db.users.find((u) => u.id === s.userId) ?? null
}

export function bumpGamesPlayed(userId: string) {
  const u = db.users.find((x) => x.id === userId)
  if (u) {
    u.gamesPlayed += 1
    save()
  }
}

/** 赛事完赛结算：参赛数 +1，刷新最佳百分比 */
export function recordEventResult(userId: string, pct: number) {
  const u = db.users.find((x) => x.id === userId)
  if (!u) return
  u.gamesPlayed += 1
  u.bestPct = Math.max(u.bestPct, Math.round(pct * 10) / 10)
  save()
}

load()
