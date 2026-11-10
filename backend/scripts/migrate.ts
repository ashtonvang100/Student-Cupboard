import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { databaseConfig } from '../src/config.js'
import { createDatabase } from '../src/db/index.js'

const { db, pool } = createDatabase(databaseConfig())
try {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename = ANY($1::text[])",
    [['categories', 'products', 'inventory', 'inventory_transactions']],
  )
  const journal = await pool.query("select to_regclass('drizzle.__drizzle_migrations') as journal")
  if (rows.length && !journal.rows[0].journal) {
    throw new Error('Existing application tables require manual schema reconciliation before initial migration')
  }
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations applied to local student_cupboard.')
} catch {
  console.error('Migration failed. Verify connectivity, inspect the existing schema, and review migration SQL before retrying. No reset or overwrite was attempted.')
  process.exitCode = 1
} finally { await pool.end() }
