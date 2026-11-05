import { eq } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { categories } from '../db/schema.js'
import { ApiError } from '../middleware/error-handler.js'
import type { Pagination } from '../validators/common.js'

export class CategoriesService {
  constructor(private db: Database) {}
  list(p: Pagination) { return this.db.select().from(categories).orderBy(categories.id).limit(p.limit + 1).offset(p.offset) }
  async get(id: number) {
    const [row] = await this.db.select().from(categories).where(eq(categories.id, id))
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Category not found')
    return row
  }
  async create(input: { name: string; description?: string | null }) {
    const [row] = await this.db.insert(categories).values(input).returning()
    return row!
  }
  async update(id: number, input: { name?: string; description?: string | null }) {
    const [row] = await this.db.update(categories).set(input).where(eq(categories.id, id)).returning()
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Category not found')
    return row
  }
}
