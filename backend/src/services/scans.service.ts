import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { inventoryScans, products, inventory, inventoryTransactions, inventoryAreaCounts, productNutrition } from '../db/schema.js'
import { ApiError } from '../middleware/error-handler.js'
import { analysisSchema, type DetectedItem, type ScanItem, type Review } from '../validators/scans.js'
import type { Pagination } from '../validators/common.js'
import type { ScanImage } from './images.service.js'
import type { VisionAnalyzer } from './openai.service.js'
const conflict = (message: string): never => { throw new ApiError(409, 'REVIEW_REQUIRED', message) }
const normalize = (value: string | null) => value?.trim().toLowerCase() ?? ''
export function matchProduct(item: DetectedItem, candidates: (typeof products.$inferSelect)[]) {
  const matches = candidates.filter(p => item.productName && normalize(p.name) === normalize(item.productName)
    && normalize(p.brand) === normalize(item.brand) && normalize(p.packageSize) === normalize(item.packageSize)
    && normalize(p.variation) === normalize(item.variation) && (!item.barcode || !p.barcode || item.barcode === p.barcode))
  return matches.length === 1 ? matches[0]!.id : null
}
export function reviewItem(item: DetectedItem, productId: number | null): ScanItem {
  return { ...item, id: randomUUID(), productId, categoryId: null, initialAreaQuantity: null,
    isNewProduct: false, excluded: false, confirmed: false,
    needsReview: item.needsReview || !productId || !item.productName || !item.unit || item.quantity === null || item.nutrition?.source === 'estimate' || item.confidence < .9 || item.quantityConfidence < .9 || item.quantityKind !== 'visible_count' || item.warnings.length > 0,
  }
}
export class ScansService {
  constructor(private db: Database, private vision: VisionAnalyzer) {}
  list(p: Pagination) {
    return this.db.select({ id: inventoryScans.id, status: inventoryScans.status, area: inventoryScans.area, actorId: inventoryScans.actorId, createdAt: inventoryScans.createdAt, errorCode: inventoryScans.errorCode }).from(inventoryScans).orderBy(desc(inventoryScans.createdAt), desc(inventoryScans.id)).limit(p.limit + 1).offset(p.offset)
  }
  async get(id: string) {
    const [scan] = await this.db.select().from(inventoryScans).where(eq(inventoryScans.id, id))
    if (!scan) throw new ApiError(404, 'NOT_FOUND', 'Scan not found')
    return scan
  }
  async create(actorId: string, key: string, area: string, images: ScanImage[]) {
    const fingerprint = createHash('sha256').update(JSON.stringify(images.map(i => i.hash).sort())).digest('hex')
    const [created] = await this.db.insert(inventoryScans).values({ actorId, idempotencyKey: key, area, fingerprint, status: 'processing' }).onConflictDoNothing().returning()
    if (!created) {
      const [byKey] = await this.db.select().from(inventoryScans).where(and(eq(inventoryScans.actorId, actorId), eq(inventoryScans.idempotencyKey, key)))
      const existing = byKey ?? (await this.db.select().from(inventoryScans).where(eq(inventoryScans.fingerprint, fingerprint)))[0]
      if (!existing || existing.fingerprint !== fingerprint || existing.area !== area) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was already used for different images or area')
      return existing
    }
    try {
      const result = analysisSchema.safeParse(await this.vision.analyze(images))
      if (!result.success) throw new ApiError(502, 'INVALID_AI_RESPONSE', 'AI response was malformed')
      const analysis = result.data
      const candidates = await this.db.select().from(products)
      const items = analysis.items.map(item => reviewItem(item, matchProduct(item, candidates)))
      const [scan] = await this.db.update(inventoryScans).set({ status: 'pending_review', analysis, items }).where(eq(inventoryScans.id, created.id)).returning()
      return scan!
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'SCAN_FAILED'
      await this.db.update(inventoryScans).set({ status: 'failed', errorCode: code }).where(eq(inventoryScans.id, created.id))
      throw error
    }
  }
  async review(id: string, itemId: string, patch: Review) {
    return this.db.transaction(async tx => {
      const [scan] = await tx.select().from(inventoryScans).where(eq(inventoryScans.id, id)).for('update')
      if (!scan) throw new ApiError(404, 'NOT_FOUND', 'Scan not found')
      if (scan.status !== 'pending_review') conflict('Only pending scans can be edited')
      const item = scan.items.find(i => i.id === itemId)
      if (!item) throw new ApiError(404, 'NOT_FOUND', 'Scan item not found')
      // Nutrition remains tied to the original identity; corrections cannot transfer its label.
      if (['productName', 'brand', 'packageSize', 'variation', 'productId'].some(k => k in patch && patch[k as keyof Review] !== item[k as keyof ScanItem])) { item.nutrition = null; item.barcode = null }
      if (['productName', 'brand', 'packageSize', 'variation'].some(k => k in patch && patch[k as keyof Review] !== item[k as keyof ScanItem]) && patch.productId === undefined) item.productId = null
      Object.assign(item, patch)
      const [updated] = await tx.update(inventoryScans).set({ items: scan.items }).where(eq(inventoryScans.id, id)).returning()
      return updated!
    })
  }
  async reject(id: string, actorId: string) {
    const [scan] = await this.db.update(inventoryScans).set({ status: 'rejected', reviewedBy: actorId, reviewedAt: new Date() }).where(and(eq(inventoryScans.id, id), eq(inventoryScans.status, 'pending_review'))).returning()
    if (!scan) { await this.get(id); conflict('Only pending scans can be rejected') }
    return scan!
  }
  async approve(id: string, actorId: string) {
    return this.db.transaction(async tx => {
      // Serialize approvals, including new product identity creation, before any row locks.
      await tx.execute(sql`select pg_advisory_xact_lock(8241)`)
      const [scan] = await tx.select().from(inventoryScans).where(eq(inventoryScans.id, id)).for('update')
      if (!scan) throw new ApiError(404, 'NOT_FOUND', 'Scan not found')
      if (scan.status === 'approved') return scan
      if (scan.status !== 'pending_review') conflict('Only pending scans can be approved')
      const seen = new Set<number>()
      // Stable ordering avoids competing scan approvals locking stock in opposite orders.
      for (const item of [...scan.items].sort((a,b) => (a.productId ?? 0) - (b.productId ?? 0))) {
        if (item.excluded) continue
        if (!item.confirmed || item.quantity === null || !item.unit) conflict('Confirm identity, quantity and unit for every included item')
        let productId = item.productId
        if (item.isNewProduct) {
          if (productId || !item.productName || !item.categoryId) conflict('New products require a name, categoryId and no productId')
          // Serialize creation of identical scan products across different scans.
          const existing = await tx.select().from(products)
          if (matchProduct(item, existing)) conflict('A matching product exists; select it instead')
          const [product] = await tx.insert(products).values({ name: item.productName!, categoryId: item.categoryId!, brand: item.brand, packageSize: item.packageSize, variation: item.variation, barcode: item.barcode }).returning()
          productId = product!.id
          await tx.insert(inventory).values({ productId, unit: item.unit! })
        }
        if (!productId) conflict('Select an existing product or explicitly mark it as new')
        if (seen.has(productId!)) conflict('Multiple items target the same product; combine their quantities or exclude duplicates')
        seen.add(productId!)
        const [stock] = await tx.select().from(inventory).where(eq(inventory.productId, productId!)).for('update')
        if (!stock) conflict('Selected product has no inventory')
        if (!item.isNewProduct && stock!.updatedAt > scan.createdAt) conflict('Inventory changed after this scan began; rescan before approval')
        if (stock!.unit !== item.unit) conflict('Reviewed unit must match the inventory unit')
        const [baseline] = await tx.select().from(inventoryAreaCounts).where(and(eq(inventoryAreaCounts.productId, productId!), eq(inventoryAreaCounts.area, scan.area)))
        if (baseline && baseline.updatedAt > scan.createdAt) conflict('A newer count for this area was approved; rescan the area')
        if (!baseline && !item.isNewProduct && item.initialAreaQuantity === null) conflict('First count requires initialAreaQuantity: the amount already included in current inventory')
        const previousArea = baseline?.quantity ?? (item.isNewProduct ? 0 : item.initialAreaQuantity!)
        if (previousArea > stock!.quantity) conflict('Area baseline exceeds current inventory; reconcile manual changes first')
        const delta = item.quantity! - previousArea
        const quantity = stock!.quantity + delta
        if (quantity < 0 || quantity > 2147483647) conflict('Resulting inventory is outside supported limits')
        if (delta) {
          await tx.update(inventory).set({ quantity }).where(eq(inventory.id, stock!.id))
          await tx.insert(inventoryTransactions).values({ productId: productId!, scanId: id, actorId, previousQuantity: stock!.quantity, newQuantity: quantity, quantityChange: delta, transactionType: 'adjustment', reason: `Approved scan of ${scan.area}` })
        }
        await tx.insert(inventoryAreaCounts).values({ productId: productId!, area: scan.area, quantity: item.quantity!, expirationDate: item.expirationDate, scanId: id }).onConflictDoUpdate({ target: [inventoryAreaCounts.productId, inventoryAreaCounts.area], set: { quantity: item.quantity!, expirationDate: item.expirationDate, scanId: id, updatedAt: new Date() } })
        const [product] = await tx.select().from(products).where(eq(products.id, productId!))
        // Preserve legacy/manual nutrition. AI candidates never overwrite an existing profile.
        if (item.nutrition && !product!.nutrition) await tx.insert(productNutrition).values({ productId: productId!, data: item.nutrition, scanId: id, verified: false }).onConflictDoNothing()
        item.productId = productId!
      }
      // Persist new product IDs in review results without changing the immutable AI analysis.
      const [approved] = await tx.update(inventoryScans).set({ status: 'approved', items: scan.items, reviewedBy: actorId, reviewedAt: new Date() }).where(eq(inventoryScans.id, id)).returning()
      return approved!
    })
  }
}
