import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

export function createDatabase(config: pg.PoolConfig) {
  const pool = new pg.Pool(config)
  pool.on('error', () => console.error('Unexpected idle PostgreSQL connection failure'))
  return { pool, db: drizzle(pool, { schema }) }
}
export type Database = ReturnType<typeof createDatabase>['db']
