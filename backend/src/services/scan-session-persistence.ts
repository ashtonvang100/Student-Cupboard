import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { inventoryAreas, inventoryScanSessions, inventorySessionAreas } from '../db/schema.js'
import { ApiError } from '../middleware/error-handler.js'

type SessionInput = { actorId: string; idempotencyKey: string } & (
  | { mode: 'full'; areaId?: never }
  | { mode: 'individual'; areaId: string }
)

export function createInventoryScanSession(db: Pick<Database, 'transaction'>, input: SessionInput) {
  const { actorId, idempotencyKey, mode } = input
  return db.transaction(async tx => {
    const [session] = await tx.insert(inventoryScanSessions)
      .values({ actorId, idempotencyKey, mode })
      .onConflictDoNothing({ target: [inventoryScanSessions.actorId, inventoryScanSessions.idempotencyKey] })
      .returning()

    if (!session) {
      const [existing] = await tx.select().from(inventoryScanSessions).where(and(
        eq(inventoryScanSessions.actorId, actorId),
        eq(inventoryScanSessions.idempotencyKey, idempotencyKey),
      ))
      if (!existing) throw new Error('Conflicting inventory scan session is missing')

      const members = await tx.select({ areaId: inventorySessionAreas.areaId })
        .from(inventorySessionAreas)
        .where(eq(inventorySessionAreas.sessionId, existing.id))
        .orderBy(asc(inventorySessionAreas.areaId))
      const areaIds = members.map(member => member.areaId)
      if (existing.mode !== mode || (input.mode === 'individual' && areaIds[0] !== input.areaId.toLowerCase())) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was already used for a different session request')
      }
      return { session: existing, areaIds, created: false }
    }

    if (input.mode === 'individual') {
      const [area] = await tx.select().from(inventoryAreas).where(eq(inventoryAreas.id, input.areaId))
      if (!area) throw new ApiError(404, 'AREA_NOT_FOUND', 'Inventory area not found')
      if (area.archivedAt) throw new ApiError(409, 'AREA_ARCHIVED', 'Inventory area is archived')
      await tx.insert(inventorySessionAreas).values({ sessionId: session.id, areaId: area.id })
      return { session, areaIds: [area.id], created: true }
    }

    // One statement snapshots the active registry and materializes the full manifest.
    const members = await tx.insert(inventorySessionAreas).select(
      tx.select({ sessionId: sql<string>`${session.id}::uuid`.as('session_id'), areaId: inventoryAreas.id })
        .from(inventoryAreas)
        .where(isNull(inventoryAreas.archivedAt)),
    ).returning({ areaId: inventorySessionAreas.areaId })
    if (!members.length) throw new ApiError(409, 'NO_ACTIVE_AREAS', 'No active inventory areas are registered')
    return { session, areaIds: members.map(member => member.areaId).sort(), created: true }
  })
}
