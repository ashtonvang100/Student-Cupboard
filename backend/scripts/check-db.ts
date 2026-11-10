import { sql } from 'drizzle-orm'
import { databaseConfig } from '../src/config.js'
import { createDatabase } from '../src/db/index.js'

const { db, pool } = createDatabase(databaseConfig())
try {
  await db.execute(sql`select 1`)
  console.log('Connected to local student_cupboard; SELECT 1 succeeded.')
} catch {
  console.error('Cannot connect to local student_cupboard. Check .env and the existing database; no database was created or modified.')
  process.exitCode = 1
} finally { await pool.end() }
