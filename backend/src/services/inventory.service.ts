import { desc, eq } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { inventory, inventoryTransactions } from '../db/schema.js'
import { ApiError } from '../middleware/error-handler.js'
import { MAX_INTEGER, type Pagination } from '../validators/common.js'
import type { InventoryPatch, TransactionInput } from '../validators/inventory.js'

function validQuantity(quantity: number) {
  if (quantity < 0) throw new ApiError(409, 'INSUFFICIENT_STOCK', 'The change would make inventory negative')
  if (quantity > MAX_INTEGER) throw new ApiError(409, 'QUANTITY_LIMIT', 'The change exceeds the maximum stock quantity')
}

export class InventoryService {
  constructor(private db: Database) {}
  list(p: Pagination) { return this.db.select().from(inventory).orderBy(inventory.id).limit(p.limit + 1).offset(p.offset) }
  async get(id: number) {
    const [row] = await this.db.select().from(inventory).where(eq(inventory.id, id))
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Inventory record not found')
    return row
  }
  async update(id: number, input: InventoryPatch) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(inventory).where(eq(inventory.id, id)).for('update')
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Inventory record not found')
      const { reason, ...changes } = input
      if (changes.unit !== undefined && changes.unit !== current.unit && current.quantity !== 0) {
        throw new ApiError(409, 'UNIT_IN_USE', 'Unit can only change when current stock is zero')
      }
      const delta = input.quantity === undefined ? 0 : input.quantity - current.quantity
      if (input.quantity !== undefined) validQuantity(input.quantity)
      const [row] = await tx.update(inventory).set(changes).where(eq(inventory.id, id)).returning()
      if (delta !== 0) await tx.insert(inventoryTransactions).values({ productId: current.productId, transactionType: 'adjustment', quantityChange: delta, reason: reason! })
      return row!
    })
  }
  async transactions(id: number, p: Pagination) {
    const row = await this.get(id)
    return this.db.select().from(inventoryTransactions).where(eq(inventoryTransactions.productId, row.productId)).orderBy(desc(inventoryTransactions.id)).limit(p.limit + 1).offset(p.offset)
  }
  async transact(id: number, input: TransactionInput) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(inventory).where(eq(inventory.id, id)).for('update')
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Inventory record not found')
      const quantity = current.quantity + input.quantityChange
      validQuantity(quantity)
      await tx.update(inventory).set({ quantity }).where(eq(inventory.id, id))
      const [transaction] = await tx.insert(inventoryTransactions).values({ productId: current.productId, ...input }).returning()
      return transaction!
    })
  }
}
