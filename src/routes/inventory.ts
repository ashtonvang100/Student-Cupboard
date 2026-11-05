import { Hono } from 'hono'
import type { InventoryService } from '../services/inventory.service.js'
import { body, collection, id, pagination } from '../validators/common.js'
import { inventoryInput, transactionInput } from '../validators/inventory.js'

export function inventoryRoutes(service: InventoryService) {
  const router = new Hono()
  router.get('/', async (c) => {
    const p = pagination(c)
    return c.json(collection(await service.list(p), p))
  })
  router.get('/:id', async (c) => c.json({ data: await service.get(id(c.req.param('id'))) }))
  router.patch('/:id', async (c) => {
    const recordId = id(c.req.param('id'))
    return c.json({ data: await service.update(recordId, inventoryInput(await body(c))) })
  })
  router.get('/:id/transactions', async (c) => {
    const recordId = id(c.req.param('id'))
    const p = pagination(c)
    return c.json(collection(await service.transactions(recordId, p), p))
  })
  router.post('/:id/transactions', async (c) => {
    const recordId = id(c.req.param('id'))
    return c.json({ data: await service.transact(recordId, transactionInput(await body(c))) }, 201)
  })
  return router
}
