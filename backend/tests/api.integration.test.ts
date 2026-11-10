import 'dotenv/config'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/db/index.js'
import { createApp } from '../src/app.js'

const url = process.env.TEST_DATABASE_URL
if (process.env.REQUIRE_TEST_DATABASE === '1' && !url) throw new Error('Set TEST_DATABASE_URL to a local student_cupboard_test database')

describe('PostgreSQL integration (isolated test records)', { skip: !url }, () => {
  const parsed = new URL(url!)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/student_cupboard_test' || parsed.search || !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Integration tests require a local student_cupboard_test URL without query parameters')
  }
  const { db, pool } = createDatabase({ connectionString: url, ssl: false, connectionTimeoutMillis: 2000 })
  const app = createApp(db)
  const marker = `test-${randomUUID()}`
  let categoryId: number
  let productId: number
  let inventoryId: number

  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await app.request(`/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
    return { status: response.status, json: await response.json() as { data: Record<string, any>; error: { code: string }; pagination: { page: number; limit: number; hasMore: boolean } } }
  }

  before(async () => {
    const result = await pool.query('select current_database() as name')
    assert.equal(result.rows[0].name, 'student_cupboard_test')
    await migrate(db, { migrationsFolder: './drizzle' })
    // A second migration must be a safe no-op.
    await migrate(db, { migrationsFolder: './drizzle' })
  })
  after(async () => {
    try {
      // Delete only this run's records, in FK order. Never truncate shared tables.
      if (categoryId) {
        await pool.query('delete from inventory_transactions where product_id in (select id from products where category_id = $1)', [categoryId])
        await pool.query('delete from inventory where product_id in (select id from products where category_id = $1)', [categoryId])
        await pool.query('delete from products where category_id = $1', [categoryId])
        await pool.query('delete from categories where id = $1', [categoryId])
      }
    } finally { await pool.end() }
  })

  test('connects and reports healthy', async () => {
    await db.execute(sql`select 1`)
    const response = await request('/health')
    assert.equal(response.status, 200)
    assert.deepEqual(response.json.data, { status: 'ok', database: 'connected' })
  })
  test('creates, retrieves, updates, and paginates categories; rejects duplicates', async () => {
    const created = await request('/categories', 'POST', { name: marker, description: 'Test category' })
    assert.equal(created.status, 201)
    categoryId = created.json.data.id
    assert.equal((await request(`/categories/${categoryId}`)).json.data.name, marker)
    assert.equal((await request(`/categories/${categoryId}`, 'PATCH', { description: null })).json.data.description, null)
    assert.equal((await request('/categories', 'POST', { name: marker.toUpperCase() })).status, 409)
    const list = await request('/categories?limit=1')
    assert.equal(list.status, 200)
    assert.equal(list.json.pagination.limit, 1)
    assert.equal(list.json.data.length, 1)
  })
  test('creates a product and inventory together, retrieves and updates product', async () => {
    const created = await request('/products', 'POST', { name: marker, categoryId, barcode: marker, nutrition: { calories: 100, servingSize: '1 cup' } })
    assert.equal(created.status, 201)
    productId = created.json.data.id
    const inventoryResult = await pool.query('select id, quantity from inventory where product_id = $1', [productId])
    inventoryId = inventoryResult.rows[0].id
    assert.equal(inventoryResult.rows[0].quantity, 0)
    assert.equal((await request(`/products/${productId}`)).json.data.nutrition.calories, 100)
    assert.equal((await request(`/products/${productId}`, 'PATCH', { brand: 'Updated', barcode: null })).json.data.brand, 'Updated')
    assert.equal((await request('/products?limit=1')).status, 200)
    assert.equal((await request('/products', 'POST', { name: marker, categoryId: 2147483647 })).status, 409)
  })
  test('duplicate product failure leaves no orphan inventory', async () => {
    await request(`/products/${productId}`, 'PATCH', { barcode: marker })
    const before = await pool.query('select count(*) from inventory')
    assert.equal((await request('/products', 'POST', { name: marker, categoryId, barcode: marker })).status, 409)
    assert.deepEqual((await pool.query('select count(*) from inventory')).rows, before.rows)
  })
  test('retrieves inventory and audits quantity patches', async () => {
    assert.equal((await request('/inventory?limit=1')).status, 200)
    const patch = await request(`/inventory/${inventoryId}`, 'PATCH', { quantity: 10, lowStockThreshold: 2, reason: 'Initial count' })
    assert.equal(patch.status, 200)
    assert.equal(patch.json.data.quantity, 10)
    assert.equal((await request(`/inventory/${inventoryId}`)).json.data.lowStockThreshold, 2)
    const history = await request(`/inventory/${inventoryId}/transactions`)
    assert.equal(history.json.data[0].transactionType, 'adjustment')
    assert.equal(history.json.data[0].quantityChange, 10)
    assert.equal((await request(`/inventory/${inventoryId}`, 'PATCH', { unit: 'box' })).status, 409)
  })
  test('creates signed transactions and preserves stock/history on insufficient stock', async () => {
    assert.equal((await request(`/inventory/${inventoryId}/transactions`, 'POST', { transactionType: 'addition', quantityChange: 3, reason: 'Delivery' })).status, 201)
    assert.equal((await request(`/inventory/${inventoryId}/transactions`, 'POST', { transactionType: 'removal', quantityChange: -2, reason: 'Distribution' })).status, 201)
    const before = await request(`/inventory/${inventoryId}/transactions`)
    const failure = await request(`/inventory/${inventoryId}/transactions`, 'POST', { transactionType: 'removal', quantityChange: -100, reason: 'Too much' })
    assert.equal(failure.status, 409)
    assert.equal(failure.json.error.code, 'INSUFFICIENT_STOCK')
    assert.equal((await request(`/inventory/${inventoryId}`)).json.data.quantity, 11)
    assert.equal((await request(`/inventory/${inventoryId}/transactions`)).json.data.length, before.json.data.length)
    assert.equal((await request(`/inventory/${inventoryId}/transactions?limit=1`)).json.pagination.hasMore, true)
  })
  test('concurrent removals serialize and cannot overspend stock', async () => {
    await request(`/inventory/${inventoryId}`, 'PATCH', { quantity: 1, reason: 'Concurrency setup' })
    const results = await Promise.all([1, 2].map(() => request(`/inventory/${inventoryId}/transactions`, 'POST', { transactionType: 'removal', quantityChange: -1, reason: 'Concurrent distribution' })))
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
    assert.equal((await request(`/inventory/${inventoryId}`)).json.data.quantity, 0)
  })
  test('rolls back quantity when transaction insertion fails', async () => {
    // Exercise transaction atomicity below the HTTP validator: PostgreSQL rejects empty reasons.
    const { InventoryService } = await import('../src/services/inventory.service.js')
    const service = new InventoryService(db)
    await assert.rejects(service.transact(inventoryId, { transactionType: 'addition', quantityChange: 2, reason: '' }))
    assert.equal((await service.get(inventoryId)).quantity, 0)
  })
  test('database constraints enforce stock, foreign keys, history, and transaction signs', async () => {
    await assert.rejects(pool.query('update inventory set quantity = -1 where id = $1', [inventoryId]))
    await assert.rejects(pool.query('update inventory set low_stock_threshold = -1 where id = $1', [inventoryId]))
    await assert.rejects(pool.query('delete from products where id = $1', [productId]))
    await assert.rejects(pool.query("insert into inventory_transactions (product_id,transaction_type,quantity_change,reason) values ($1,'addition',-1,'invalid')", [productId]))
    assert.equal((await request(`/inventory/${inventoryId}`)).json.data.quantity, 0)
  })
  test('rejects invalid requests, missing records, negative stock, and overflow', async () => {
    for (const path of ['/categories/2147483647', '/products/2147483647', '/inventory/2147483647', '/inventory/2147483647/transactions']) assert.equal((await request(path)).status, 404)
    for (const path of ['/categories/2147483647', '/products/2147483647']) assert.equal((await request(path, 'PATCH', { name: 'missing' })).status, 404)
    assert.equal((await request('/inventory/2147483647', 'PATCH', { lowStockThreshold: 1 })).status, 404)
    assert.equal((await request('/inventory/2147483647/transactions', 'POST', { transactionType: 'addition', quantityChange: 1, reason: 'Missing' })).status, 404)
    assert.equal((await request('/products', 'POST', { name: 'Missing category' })).status, 400)
    assert.equal((await request('/categories', 'POST', { name: '' })).status, 400)
    assert.equal((await request(`/inventory/${inventoryId}`, 'PATCH', { quantity: -1, reason: 'Invalid' })).status, 400)
    assert.equal((await request(`/inventory/${inventoryId}/transactions`, 'POST', { transactionType: 'removal', quantityChange: 1, reason: 'Wrong sign' })).status, 400)
    await request(`/inventory/${inventoryId}`, 'PATCH', { quantity: 2147483647, reason: 'Maximum' })
    assert.equal((await request(`/inventory/${inventoryId}/transactions`, 'POST', { transactionType: 'addition', quantityChange: 1, reason: 'Overflow' })).status, 409)
  })
})
