import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

export class ApiError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 502 | 503 | 504, public code: string, message: string) {
    super(message)
  }
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  if ('cause' in error) return postgresCode(error.cause)
  return undefined
}

export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status)
  }
  if (error instanceof HTTPException) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: error.status < 500 ? error.message : 'Request failed' } }, error.status)
  }
  const code = postgresCode(error)
  if (code === '23505') return c.json({ error: { code: 'CONFLICT', message: 'A record with that unique value already exists' } }, 409)
  if (code === '23503') return c.json({ error: { code: 'INVALID_REFERENCE', message: 'The referenced record does not exist' } }, 409)
  if (code === '23514' || code === '22003') return c.json({ error: { code: 'INVALID_VALUE', message: 'The change violates a data constraint' } }, 400)
  // Never log SQL, parameters, connection URLs, or raw driver errors.
  console.error('Unhandled API error', { databaseCode: code && /^[0-9A-Z]{5}$/.test(code) ? code : undefined })
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, 500)
}
