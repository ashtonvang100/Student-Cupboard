import { sql } from 'drizzle-orm'
import { pgTable, integer, text, varchar, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core'

export type Nutrition = {
  servingSize?: string
  calories?: number
  totalFatGrams?: number
  sodiumMilligrams?: number
  totalCarbohydrateGrams?: number
  proteinGrams?: number
}

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())

export const categories = pgTable('categories', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('categories_name_unique').on(sql`lower(${t.name})`), check('categories_name_nonempty', sql`length(trim(${t.name})) > 0`)])

export const products = pgTable('products', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: varchar('name', { length: 200 }).notNull(),
  brand: varchar('brand', { length: 200 }),
  barcode: varchar('barcode', { length: 100 }).unique(),
  description: text('description'),
  categoryId: integer('category_id').notNull().references(() => categories.id, { onDelete: 'restrict' }),
  nutrition: jsonb('nutrition').$type<Nutrition>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('products_category_id_idx').on(t.categoryId), check('products_name_nonempty', sql`length(trim(${t.name})) > 0`), check('products_barcode_nonempty', sql`${t.barcode} IS NULL OR length(trim(${t.barcode})) > 0`)])

export const inventory = pgTable('inventory', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  productId: integer('product_id').notNull().unique().references(() => products.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(0),
  unit: varchar('unit', { length: 50 }).notNull().default('each'),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [check('inventory_quantity_nonnegative', sql`${t.quantity} >= 0`), check('inventory_threshold_nonnegative', sql`${t.lowStockThreshold} >= 0`), check('inventory_unit_nonempty', sql`length(trim(${t.unit})) > 0`)])

export const inventoryTransactions = pgTable('inventory_transactions', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  transactionType: varchar('transaction_type', { length: 20 }).$type<'addition' | 'removal' | 'adjustment'>().notNull(),
  quantityChange: integer('quantity_change').notNull(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('inventory_transactions_product_id_id_idx').on(t.productId, t.id),
  check('inventory_transactions_type_and_sign', sql`(${t.transactionType} = 'addition' AND ${t.quantityChange} > 0) OR (${t.transactionType} = 'removal' AND ${t.quantityChange} < 0) OR (${t.transactionType} = 'adjustment' AND ${t.quantityChange} <> 0)`),
  check('inventory_transactions_reason_nonempty', sql`length(trim(${t.reason})) > 0`),
])
