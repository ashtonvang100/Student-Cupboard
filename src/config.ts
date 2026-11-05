import 'dotenv/config'
import type { PoolConfig } from 'pg'
import { userInfo } from 'node:os'

export function integerSetting(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return Number(value)
}

type LocalDatabaseConfig = PoolConfig & { host: string; port: number; database: string; user: string; password?: string; ssl: false }

export function databaseConfig(): LocalDatabaseConfig {
  const host = process.env.PGHOST || 'localhost'
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Only local PostgreSQL hosts are enabled. Remote database access requires an explicit configuration review.')
  }
  if (process.env.PGDATABASE !== 'student_cupboard') {
    throw new Error('PGDATABASE must be student_cupboard')
  }
  return {
    host,
    port: integerSetting(process.env.PGPORT, 5432, 'PGPORT'),
    database: 'student_cupboard',
    user: process.env.PGUSER || userInfo().username,
    password: process.env.PGPASSWORD || undefined,
    ssl: false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  }
}
