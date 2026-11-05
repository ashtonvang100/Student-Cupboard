import { defineConfig } from 'drizzle-kit'
import { databaseConfig } from './src/config.js'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: databaseConfig(),
  strict: true,
  verbose: false,
})
