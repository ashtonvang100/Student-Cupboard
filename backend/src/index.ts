import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { databaseConfig, integerSetting } from './config.js'
import { createDatabase } from './db/index.js'

const { db, pool } = createDatabase(databaseConfig())
const host = process.env.HOST || '127.0.0.1'
const port = integerSetting(process.env.PORT, 3000, 'PORT')
const app = createApp(db)
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Server is running on http://${host}:${info.port}`)
  console.log('Development API: authentication and authorization are not configured.')
})

let closing = false
function shutdown() {
  if (closing) return
  closing = true
  const timeout = setTimeout(() => process.exit(1), 10000)
  timeout.unref()
  server.close(async () => {
    try { await pool.end() } finally { clearTimeout(timeout) }
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
