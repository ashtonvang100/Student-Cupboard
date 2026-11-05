import type { Context } from 'hono'
import { ApiError } from '../middleware/error-handler.js'

export const MAX_INTEGER = 2147483647
export function invalid(message: string): never { throw new ApiError(400, 'VALIDATION_ERROR', message) }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Body must be a JSON object')
  return value as Record<string, unknown>
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid('Request contains unsupported fields')
}
export function string(value: unknown, field: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`${field} must be a nonempty string of at most ${max} characters`)
  return value.trim()
}
export function integer(value: unknown, field: string, min = 0, max = MAX_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(`${field} must be an integer between ${min} and ${max}`)
  return value
}
export function id(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) invalid('id must be a positive integer')
  return integer(Number(value), 'id', 1)
}
export type Pagination = { page: number; limit: number; offset: number }
export function pagination(c: Context): Pagination {
  keys(c.req.query(), ['page', 'limit'])
  for (const key of ['page', 'limit']) {
    const values = c.req.queries(key)
    if (values && (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]!))) invalid(`${key} must be a positive integer`)
  }
  const page = integer(Number(c.req.query('page') ?? 1), 'page', 1, 1000000)
  const limit = integer(Number(c.req.query('limit') ?? 20), 'limit', 1, 100)
  return { page, limit, offset: (page - 1) * limit }
}
export function collection<T>(rows: T[], p: Pagination) {
  return { data: rows.slice(0, p.limit), pagination: { page: p.page, limit: p.limit, hasMore: rows.length > p.limit } }
}
export async function body(c: Context): Promise<unknown> {
  if (c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  }
  try { return await c.req.json() } catch { return invalid('Body must contain valid JSON') }
}
